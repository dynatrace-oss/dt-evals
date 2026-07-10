import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We'll mock the provider modules so no real API calls are made
vi.mock("openai", () => {
  const mockClient = {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  };
  return {
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    default: vi.fn().mockImplementation(function () {
      return mockClient;
    }),
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    AzureOpenAI: vi.fn().mockImplementation(function () {
      return mockClient;
    }),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    default: vi.fn().mockImplementation(function () {
      return {
        messages: {
          create: vi.fn(),
        },
      };
    }),
  };
});

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    BedrockRuntimeClient: vi.fn().mockImplementation(function () {
      return { send: vi.fn() };
    }),
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    ConverseCommand: vi.fn().mockImplementation(function (input) {
      return input;
    }),
  };
});

vi.mock("@google/genai", () => {
  return {
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    GoogleGenAI: vi.fn().mockImplementation(function () {
      return {
        models: {
          generateContent: vi.fn(),
        },
      };
    }),
  };
});

import { evaluate } from "../src/engine/index";
import { AnthropicProvider } from "../src/engine/providers/anthropic";
import { AzureOpenAIProvider } from "../src/engine/providers/azure-openai";
import { BedrockProvider } from "../src/engine/providers/bedrock";
import { GoogleProvider } from "../src/engine/providers/google";
import { createProvider } from "../src/engine/providers/index";
import { OpenAIProvider } from "../src/engine/providers/openai";
import type { LLMJudgeResponse, LLMProvider } from "../src/engine/providers/types";
import type { EvalConfig, EvalInput, ProviderOptions } from "../src/engine/types";
import {
  EvalConfigError,
  EvalInputError,
  EvalResponseError,
  EvalTimeoutError,
} from "../src/errors";
import type { PromptDefinition } from "../src/prompts/types";
import { BuiltInMetric } from "../src/prompts/types";

// Helper to create a mock provider
function mockProvider(response: LLMJudgeResponse): LLMProvider {
  return {
    call: vi.fn().mockResolvedValue(response),
  };
}

function failingProvider(error: Error, succeedAfter?: number): LLMProvider {
  let callCount = 0;
  return {
    call: vi.fn().mockImplementation(async () => {
      callCount++;
      if (succeedAfter !== undefined && callCount > succeedAfter) {
        return { scoreValue: 1, summary: "ok", reasoning: "recovered" };
      }
      throw error;
    }),
  };
}

// We mock createProvider in the evaluate tests to inject our mock providers
vi.mock("../src/engine/providers/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine/providers/index")>();
  return {
    ...actual,
    createProvider: vi.fn(actual.createProvider),
  };
});

const baseProviderOptions: ProviderOptions = {
  provider: "openai",
  apiKey: "test-key-123",
  timeout: 30000,
  maxRetries: 2,
};

const baseConfig: EvalConfig = {
  provider: baseProviderOptions,
};

const baseInput: EvalInput = {
  input: "What is the capital of France?",
  output: "The capital of France is Paris.",
};

const customPrompt: PromptDefinition = {
  id: "test-metric",
  name: "Test Metric",
  version: "1.0.0",
  description: "A test metric",
  prompt: "Evaluate this: Input: {{input}} Output: {{output}}",
  requiredFields: ["input", "output"],
  scoring: { type: "binary", range: [0, 1], threshold: 1 },
};

describe("evaluate() — happy path", () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "Good output", reasoning: "Output is correct" }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates with a BuiltInMetric enum value", async () => {
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig);
    expect(result).toBeDefined();
    expect(result.score).toBeDefined();
    expect(result.explanation).toBeDefined();
  });

  it("evaluates with a PromptDefinition object directly", async () => {
    const result = await evaluate(customPrompt, baseInput, baseConfig);
    expect(result).toBeDefined();
    expect(result.score.value).toBe(1);
  });

  it("returns correct EvalResult shape { score: { value, label }, explanation: { summary, reasoning } }", async () => {
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig);
    expect(result).toEqual({
      score: { value: 1, label: "pass" },
      explanation: { summary: "Good output", reasoning: "Output is correct" },
    });
  });

  it("binary scoring: score 1 → pass", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "safe", reasoning: "no issues" }),
    );
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig);
    expect(result.score).toEqual({ value: 1, label: "pass" });
  });

  it("binary scoring: score 0 → fail", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 0, summary: "toxic", reasoning: "contains slurs" }),
    );
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig);
    expect(result.score).toEqual({ value: 0, label: "fail" });
  });

  it("continuous scoring: score 0.8 → pass", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 0.8, summary: "relevant", reasoning: "on topic" }),
    );
    const result = await evaluate(BuiltInMetric.Relevance, baseInput, baseConfig);
    expect(result.score).toEqual({ value: 0.8, label: "pass" });
  });

  it("user-frustration binary: score 1 → pass (ok)", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "not frustrated", reasoning: "user left satisfied" }),
    );
    const result = await evaluate(BuiltInMetric.UserFrustration, baseInput, baseConfig);
    expect(result.score).toEqual({ value: 1, label: "pass" });
  });

  it("thresholdOverride: continuous with custom threshold 0.9 — score 0.8 → fail", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 0.8, summary: "ok", reasoning: "decent" }),
    );
    const result = await evaluate(BuiltInMetric.Relevance, baseInput, {
      ...baseConfig,
      scoring: { thresholdOverride: 0.9 },
    });
    expect(result.score).toEqual({ value: 0.8, label: "fail" });
  });

  it("thresholdOverride: is passed through to computeScore", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 0.4, summary: "ok", reasoning: "ok" }),
    );
    // Default continuous threshold is 0.5, so 0.4 would fail
    // Override to 0.3, so 0.4 should pass
    const result = await evaluate(BuiltInMetric.Relevance, baseInput, {
      ...baseConfig,
      scoring: { thresholdOverride: 0.3 },
    });
    expect(result.score.label).toBe("pass");
  });
});

describe("evaluate() — prompt rendering", () => {
  let capturedPrompt: string;

  beforeEach(() => {
    const provider: LLMProvider = {
      call: vi.fn().mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { scoreValue: 1, summary: "ok", reasoning: "ok" };
      }),
    };
    vi.mocked(createProvider).mockResolvedValue(provider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("replaces {{input}} placeholder", async () => {
    await evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig);
    expect(capturedPrompt).toContain("What is the capital of France?");
    expect(capturedPrompt).not.toContain("{{input}}");
  });

  it("replaces {{output}} placeholder", async () => {
    await evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig);
    expect(capturedPrompt).toContain("The capital of France is Paris.");
    expect(capturedPrompt).not.toContain("{{output}}");
  });

  it("replaces {{context}} placeholder when present", async () => {
    const input: EvalInput = {
      ...baseInput,
      context: "France is a country in Europe. Its capital is Paris.",
    };
    await evaluate(BuiltInMetric.Faithfulness, input, baseConfig);
    expect(capturedPrompt).toContain("France is a country in Europe");
    expect(capturedPrompt).not.toContain("{{context}}");
  });

  it("replaces {{expectedOutput}} placeholder when present", async () => {
    const input: EvalInput = {
      ...baseInput,
      expectedOutput: "Paris is the capital of France.",
    };
    await evaluate(BuiltInMetric.FactualAccuracy, input, baseConfig);
    expect(capturedPrompt).toContain("Paris is the capital of France.");
    expect(capturedPrompt).not.toContain("{{expectedOutput}}");
  });

  it("omits optional placeholders when fields not provided", async () => {
    await evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig);
    // toxicity only requires input + output, no context/expectedOutput placeholders in its prompt
    expect(capturedPrompt).not.toContain("{{context}}");
    expect(capturedPrompt).not.toContain("{{expectedOutput}}");
  });
});

describe("evaluate() — input validation", () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "ok", reasoning: "ok" }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws EvalInputError when required field 'context' is missing for faithfulness", async () => {
    await expect(
      evaluate(BuiltInMetric.Faithfulness, baseInput, baseConfig),
    ).rejects.toBeInstanceOf(EvalInputError);
  });

  it("does not throw when 'expectedOutput' is omitted for factual-accuracy (optional field)", async () => {
    await expect(
      evaluate(BuiltInMetric.FactualAccuracy, baseInput, baseConfig),
    ).resolves.toBeDefined();
  });

  it("error message lists missing fields", async () => {
    try {
      await evaluate(BuiltInMetric.Faithfulness, baseInput, baseConfig);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("context");
    }
  });
});

describe("evaluate() — error handling", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../src/engine/providers/index")>(
      "../src/engine/providers/index",
    );
    vi.mocked(createProvider).mockImplementation(actual.createProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws EvalConfigError when API key is missing", async () => {
    const config: EvalConfig = { provider: { provider: "openai" } };
    const origEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(evaluate(BuiltInMetric.Toxicity, baseInput, config)).rejects.toBeInstanceOf(
        EvalConfigError,
      );
    } finally {
      if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("throws EvalTimeoutError on provider timeout", async () => {
    const timeoutError = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    vi.mocked(createProvider).mockResolvedValue(failingProvider(timeoutError));
    await expect(evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig)).rejects.toBeInstanceOf(
      EvalTimeoutError,
    );
  });

  it("throws EvalResponseError on malformed LLM response", async () => {
    const provider: LLMProvider = {
      call: vi
        .fn()
        .mockRejectedValue(
          new EvalResponseError(
            "Malformed LLM response: expected { scoreValue: number, summary: string, reasoning: string }",
          ),
        ),
    };
    vi.mocked(createProvider).mockResolvedValue(provider);
    await expect(evaluate(BuiltInMetric.Toxicity, baseInput, baseConfig)).rejects.toBeInstanceOf(
      EvalResponseError,
    );
  });

  it("retries on transient error up to maxRetries", async () => {
    const transientError = Object.assign(new Error("rate limit"), { status: 429 });
    const provider = failingProvider(transientError, 2); // succeeds on 3rd call
    vi.mocked(createProvider).mockResolvedValue(provider);
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, {
      provider: { ...baseProviderOptions, maxRetries: 2 },
    });
    expect(result.score.value).toBe(1);
    expect(provider.call).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("throws after exhausting retries", async () => {
    const transientError = Object.assign(new Error("rate limit"), { status: 429 });
    vi.mocked(createProvider).mockResolvedValue(failingProvider(transientError));
    await expect(
      evaluate(BuiltInMetric.Toxicity, baseInput, {
        provider: { ...baseProviderOptions, maxRetries: 2 },
      }),
    ).rejects.toThrow();
  });

  it("uses exponential backoff between retries", async () => {
    const transientError = Object.assign(new Error("rate limit"), { status: 429 });
    const provider = failingProvider(transientError, 2);
    vi.mocked(createProvider).mockResolvedValue(provider);

    await evaluate(BuiltInMetric.Toxicity, baseInput, {
      provider: { ...baseProviderOptions, maxRetries: 2 },
    });
    // Just verify multiple calls were made (backoff is internal)
    expect(provider.call).toHaveBeenCalledTimes(3);
  });

  it("throws EvalConfigError for negative maxRetries", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "ok", reasoning: "ok" }),
    );
    await expect(
      evaluate(BuiltInMetric.Toxicity, baseInput, {
        provider: { ...baseProviderOptions, maxRetries: -1 },
      }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });

  it("throws EvalConfigError for non-integer maxRetries", async () => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "ok", reasoning: "ok" }),
    );
    await expect(
      evaluate(BuiltInMetric.Toxicity, baseInput, {
        provider: { ...baseProviderOptions, maxRetries: 2.5 },
      }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });
});

describe("provider factory", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../src/engine/providers/index")>(
      "../src/engine/providers/index",
    );
    vi.mocked(createProvider).mockImplementation(actual.createProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates OpenAI provider when provider is 'openai'", async () => {
    const provider = await createProvider({
      provider: "openai",
      apiKey: "test-key",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("creates Anthropic provider when provider is 'anthropic'", async () => {
    const provider = await createProvider({
      provider: "anthropic",
      apiKey: "test-key",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("uses explicit apiKey over env var", async () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-key";
    try {
      const provider = await createProvider({
        provider: "openai",
        apiKey: "explicit-key",
        timeout: 30000,
        maxRetries: 2,
      });
      expect(provider).toBeInstanceOf(OpenAIProvider);
    } finally {
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("falls back to env var when apiKey not provided", async () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-key";
    try {
      const provider = await createProvider({
        provider: "openai",
        timeout: 30000,
        maxRetries: 2,
      });
      expect(provider).toBeInstanceOf(OpenAIProvider);
    } finally {
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  it("uses custom model when specified", async () => {
    const provider = await createProvider({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4-turbo",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("uses default model when not specified", async () => {
    const provider = await createProvider({
      provider: "openai",
      apiKey: "test-key",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("uses explicit baseUrl from config", async () => {
    const provider = await createProvider({
      provider: "openai",
      apiKey: "test-key",
      baseUrl: "https://custom.api.example.com/v1",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("falls back to OPENAI_BASE_URL env var", async () => {
    const origUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = "https://env.api.example.com/v1";
    try {
      const provider = await createProvider({
        provider: "openai",
        apiKey: "test-key",
        timeout: 30000,
        maxRetries: 2,
      });
      expect(provider).toBeInstanceOf(OpenAIProvider);
    } finally {
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl;
      else delete process.env.OPENAI_BASE_URL;
    }
  });

  it("falls back to ANTHROPIC_BASE_URL env var", async () => {
    const origUrl = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://env.api.example.com";
    try {
      const provider = await createProvider({
        provider: "anthropic",
        apiKey: "test-key",
        timeout: 30000,
        maxRetries: 2,
      });
      expect(provider).toBeInstanceOf(AnthropicProvider);
    } finally {
      if (origUrl !== undefined) process.env.ANTHROPIC_BASE_URL = origUrl;
      else delete process.env.ANTHROPIC_BASE_URL;
    }
  });
});

describe("provider factory — vertex", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../src/engine/providers/index")>(
      "../src/engine/providers/index",
    );
    vi.mocked(createProvider).mockImplementation(actual.createProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates Vertex provider when provider is 'vertex' with apiKey", async () => {
    const provider = await createProvider({
      provider: "vertex",
      apiKey: "test-key",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(GoogleProvider);
  });

  it("creates Vertex provider via ADC without an API key (project from options)", async () => {
    const provider = await createProvider({
      provider: "vertex",
      project: "test-project",
      location: "us-central1",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(GoogleProvider);
  });

  it("does not require GOOGLE_API_KEY for vertex — uses Workload Identity / ADC instead", async () => {
    const origKey = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      const provider = await createProvider({
        provider: "vertex",
        project: "test-project",
        location: "us-central1",
        timeout: 30000,
        maxRetries: 2,
      });
      expect(provider).toBeInstanceOf(GoogleProvider);
    } finally {
      if (origKey !== undefined) process.env.GOOGLE_API_KEY = origKey;
    }
  });

  it("uses custom model when specified", async () => {
    const provider = await createProvider({
      provider: "vertex",
      apiKey: "test-key",
      model: "gemini-2.5-pro",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(GoogleProvider);
  });
});

describe("evaluate() — vertex provider", () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "Good output", reasoning: "Output is correct" }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates with vertex provider", async () => {
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, {
      provider: { provider: "vertex", apiKey: "test-key" },
    });
    expect(result).toBeDefined();
    expect(result.score).toBeDefined();
    expect(result.explanation).toBeDefined();
  });

  it("returns correct EvalResult shape with vertex provider", async () => {
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, {
      provider: { provider: "vertex", apiKey: "test-key" },
    });
    expect(result).toEqual({
      score: { value: 1, label: "pass" },
      explanation: { summary: "Good output", reasoning: "Output is correct" },
    });
  });
});

describe("provider factory — gemini", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../src/engine/providers/index")>(
      "../src/engine/providers/index",
    );
    vi.mocked(createProvider).mockImplementation(actual.createProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates Gemini provider when provider is 'gemini' with apiKey", async () => {
    const provider = await createProvider({
      provider: "gemini",
      apiKey: "test-key",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(GoogleProvider);
  });

  it("falls back to GOOGLE_API_KEY env var", async () => {
    const origKey = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "env-google-key";
    try {
      const provider = await createProvider({
        provider: "gemini",
        timeout: 30000,
        maxRetries: 2,
      });
      expect(provider).toBeInstanceOf(GoogleProvider);
    } finally {
      if (origKey !== undefined) process.env.GOOGLE_API_KEY = origKey;
      else delete process.env.GOOGLE_API_KEY;
    }
  });

  it("throws EvalConfigError when no apiKey is provided for gemini", async () => {
    const origKey = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      await expect(
        createProvider({
          provider: "gemini",
          timeout: 30000,
          maxRetries: 2,
        }),
      ).rejects.toBeInstanceOf(EvalConfigError);
    } finally {
      if (origKey !== undefined) process.env.GOOGLE_API_KEY = origKey;
    }
  });
});

describe("evaluate() — gemini provider", () => {
  beforeEach(() => {
    vi.mocked(createProvider).mockResolvedValue(
      mockProvider({ scoreValue: 1, summary: "Good output", reasoning: "Output is correct" }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates with gemini provider", async () => {
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, {
      provider: { provider: "gemini", apiKey: "test-key" },
    });
    expect(result).toBeDefined();
    expect(result.score).toBeDefined();
    expect(result.explanation).toBeDefined();
  });

  it("returns correct EvalResult shape with gemini provider", async () => {
    const result = await evaluate(BuiltInMetric.Toxicity, baseInput, {
      provider: { provider: "gemini", apiKey: "test-key" },
    });
    expect(result).toEqual({
      score: { value: 1, label: "pass" },
      explanation: { summary: "Good output", reasoning: "Output is correct" },
    });
  });
});

// ---------------------------------------------------------------------------
// Azure OpenAI provider
// ---------------------------------------------------------------------------

describe("provider factory — azure-openai", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../src/engine/providers/index")>(
      "../src/engine/providers/index",
    );
    vi.mocked(createProvider).mockImplementation(actual.createProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_VERSION;
  });

  it("creates AzureOpenAIProvider when all required fields are provided", async () => {
    const provider = await createProvider({
      provider: "azure-openai",
      apiKey: "test-key",
      baseUrl: "https://my-resource.openai.azure.com/",
      apiVersion: "2025-04-01-preview",
      model: "my-gpt4-deployment",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(AzureOpenAIProvider);
  });

  it("throws EvalConfigError when apiKey is missing", async () => {
    await expect(
      createProvider({
        provider: "azure-openai",
        baseUrl: "https://my-resource.openai.azure.com/",
        apiVersion: "2025-04-01-preview",
        model: "my-gpt4-deployment",
        timeout: 30000,
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });

  it("throws EvalConfigError when baseUrl is missing", async () => {
    await expect(
      createProvider({
        provider: "azure-openai",
        apiKey: "test-key",
        apiVersion: "2025-04-01-preview",
        model: "my-gpt4-deployment",
        timeout: 30000,
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });

  it("throws EvalConfigError when apiVersion is missing", async () => {
    await expect(
      createProvider({
        provider: "azure-openai",
        apiKey: "test-key",
        baseUrl: "https://my-resource.openai.azure.com/",
        model: "my-gpt4-deployment",
        timeout: 30000,
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });

  it("throws EvalConfigError when model (deployment name) is missing", async () => {
    await expect(
      createProvider({
        provider: "azure-openai",
        apiKey: "test-key",
        baseUrl: "https://my-resource.openai.azure.com/",
        apiVersion: "2025-04-01-preview",
        timeout: 30000,
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(EvalConfigError);
  });

  it("falls back to env vars when fields are not provided in options", async () => {
    process.env.AZURE_OPENAI_API_KEY = "env-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://env-resource.openai.azure.com/";
    process.env.AZURE_OPENAI_API_VERSION = "2025-04-01-preview";
    const provider = await createProvider({
      provider: "azure-openai",
      model: "my-deployment",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(AzureOpenAIProvider);
  });
});

// ---------------------------------------------------------------------------
// Bedrock provider
// ---------------------------------------------------------------------------

describe("provider factory — bedrock", () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../src/engine/providers/index")>(
      "../src/engine/providers/index",
    );
    vi.mocked(createProvider).mockImplementation(actual.createProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
  });

  it("creates BedrockProvider when credentials are provided", async () => {
    const provider = await createProvider({
      provider: "bedrock",
      apiKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  it("does not throw when credentials are missing — defers to the AWS default credential chain", async () => {
    // Eagerly requiring AWS_ACCESS_KEY_ID/SECRET would break IAM-role,
    // AWS_PROFILE and SSO auth that the SDK resolves on its own. The factory
    // must construct the provider and let the SDK chain resolve credentials.
    const provider = await createProvider({
      provider: "bedrock",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  it("falls back to AWS env vars for credentials", async () => {
    process.env.AWS_ACCESS_KEY_ID = "env-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "env-secret-key";
    const provider = await createProvider({
      provider: "bedrock",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  it("uses explicit region when provided", async () => {
    process.env.AWS_ACCESS_KEY_ID = "env-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "env-secret-key";
    const provider = await createProvider({
      provider: "bedrock",
      region: "eu-west-1",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  it("falls back to AWS_REGION env var for region", async () => {
    process.env.AWS_ACCESS_KEY_ID = "env-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "env-secret-key";
    process.env.AWS_REGION = "ap-southeast-1";
    const provider = await createProvider({
      provider: "bedrock",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });

  it("uses default Bedrock model when model not specified", async () => {
    process.env.AWS_ACCESS_KEY_ID = "env-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "env-secret-key";
    const provider = await createProvider({
      provider: "bedrock",
      timeout: 30000,
      maxRetries: 2,
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
  });
});
