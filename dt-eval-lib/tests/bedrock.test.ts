import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capturing mock: records the config object handed to BedrockRuntimeClient so
// we can assert exactly which credentials (if any) are forwarded, and lets us
// stub the Converse response for the fence-stripping test.
const clientCtor = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    BedrockRuntimeClient: clientCtor.mockImplementation(function () {
      return { send: sendMock };
    }),
    // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
    ConverseCommand: vi.fn().mockImplementation(function (input: unknown) {
      return input;
    }),
  };
});

import { BedrockProvider } from "../src/engine/providers/bedrock";
import { createProvider } from "../src/engine/providers/index";

function lastClientConfig(): { region?: string; credentials?: unknown } {
  const calls = clientCtor.mock.calls;
  return calls[calls.length - 1][0] as { region?: string; credentials?: unknown };
}

function mockConverseText(text: string): void {
  sendMock.mockResolvedValue({ output: { message: { content: [{ text }] } } });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  clientCtor.mockClear();
  sendMock.mockReset();
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("BedrockProvider credentials", () => {
  it("builds explicit credentials from configured static apiKey + secretKey", () => {
    new BedrockProvider({ apiKey: "AKIA", secretKey: "secret", model: "m", timeout: 1000 });
    expect(lastClientConfig().credentials).toEqual({
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
    });
  });

  it("leaves credentials undefined when no static credentials are configured (default chain)", () => {
    process.env.AWS_ACCESS_KEY_ID = "env-key";
    process.env.AWS_SECRET_ACCESS_KEY = "env-secret";
    process.env.AWS_SESSION_TOKEN = "session-tok";
    new BedrockProvider({ apiKey: "", model: "m", timeout: 1000 });
    expect(lastClientConfig().credentials).toBeUndefined();
  });
});

describe("createProvider for bedrock", () => {
  it("does not throw when no AWS credentials are present and leaves the default chain to resolve them", async () => {
    const provider = await createProvider({
      provider: "bedrock",
      model: "m",
      timeout: 1000,
      maxRetries: 1,
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
    expect(lastClientConfig().credentials).toBeUndefined();
  });

  it("builds explicit credentials from configured apiKey + secretKey", async () => {
    await createProvider({
      provider: "bedrock",
      apiKey: "AKIA",
      secretKey: "secret",
      model: "m",
      timeout: 1000,
      maxRetries: 1,
    });
    expect(lastClientConfig().credentials).toMatchObject({
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
    });
  });
});

describe("BedrockProvider.call markdown fences", () => {
  it("parses JSON wrapped in ```json code fences", async () => {
    mockConverseText('```json\n{"scoreValue": 1, "summary": "ok", "reasoning": "good"}\n```');
    const provider = new BedrockProvider({
      apiKey: "AKIA",
      secretKey: "s",
      model: "m",
      timeout: 1000,
    });
    const result = await provider.call("prompt");
    expect(result).toEqual({ scoreValue: 1, summary: "ok", reasoning: "good" });
  });

  it("parses bare JSON without fences", async () => {
    mockConverseText('{"scoreValue": 0, "summary": "no", "reasoning": "bad"}');
    const provider = new BedrockProvider({
      apiKey: "AKIA",
      secretKey: "s",
      model: "m",
      timeout: 1000,
    });
    const result = await provider.call("prompt");
    expect(result).toEqual({ scoreValue: 0, summary: "no", reasoning: "bad" });
  });
});
