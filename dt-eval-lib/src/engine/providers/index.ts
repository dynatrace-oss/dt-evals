import { EvalConfigError } from "../../errors";
import type { ProviderOptions } from "../types";
import type { LLMProvider } from "./types";

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6",
  vertex: "gemini-3.1-pro-preview",
  gemini: "gemini-3-flash-preview",
  // azure-openai: no default — deployment names are user-defined in Azure portal
  bedrock: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
};

const ENV_API_KEY: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  vertex: "GOOGLE_API_KEY",
  gemini: "GOOGLE_API_KEY",
  "azure-openai": "AZURE_OPENAI_API_KEY",
  bedrock: "AWS_ACCESS_KEY_ID",
};

const ENV_BASE_URL: Record<string, string> = {
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
  "azure-openai": "AZURE_OPENAI_ENDPOINT",
};

const VALID_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "vertex",
  "gemini",
  "azure-openai",
  "bedrock",
]);

export async function createProvider(options: ProviderOptions): Promise<LLMProvider> {
  const provider = options.provider;

  if (!VALID_PROVIDERS.has(provider)) {
    throw new EvalConfigError(`Unknown provider: ${provider}`);
  }

  const timeout = options.timeout ?? 30000;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new EvalConfigError(`timeout must be a positive integer (ms), got ${timeout}`);
  }

  const model = options.model ?? DEFAULT_MODELS[provider];

  // --- Google (Vertex / Gemini) ---
  if (provider === "vertex" || provider === "gemini") {
    const apiKey = options.apiKey ?? process.env[ENV_API_KEY[provider]];
    if (!apiKey) {
      throw new EvalConfigError(
        `Missing API key for ${provider}. Provide provider.apiKey or set ${ENV_API_KEY[provider]}.`,
      );
    }
    const { GoogleProvider } = await import("./google");
    return new GoogleProvider({ apiKey, model, timeout, vertexai: provider === "vertex" });
  }

  // --- Azure OpenAI ---
  if (provider === "azure-openai") {
    const apiKey = options.apiKey ?? process.env[ENV_API_KEY[provider]];
    const baseUrl = options.baseUrl ?? process.env[ENV_BASE_URL[provider]];
    const apiVersion = options.apiVersion ?? process.env.AZURE_OPENAI_API_VERSION;

    if (!apiKey) {
      throw new EvalConfigError(
        "Missing API key for azure-openai. Provide provider.apiKey or set AZURE_OPENAI_API_KEY.",
      );
    }
    if (!baseUrl) {
      throw new EvalConfigError(
        "Missing endpoint for azure-openai. Provide provider.baseUrl or set AZURE_OPENAI_ENDPOINT.",
      );
    }
    if (!apiVersion) {
      throw new EvalConfigError(
        "Missing API version for azure-openai. Provide provider.apiVersion or set AZURE_OPENAI_API_VERSION.",
      );
    }
    if (!options.model) {
      throw new EvalConfigError(
        "Missing model for azure-openai. Provide provider.model set to your Azure deployment name " +
          "(e.g. my-gpt4-deployment). Azure deployment names are user-defined and have no default.",
      );
    }

    const { AzureOpenAIProvider } = await import("./azure-openai");
    return new AzureOpenAIProvider({ apiKey, model, timeout, baseUrl, apiVersion });
  }

  // --- Bedrock ---
  if (provider === "bedrock") {
    // Pass through only explicitly-configured static credentials. When absent,
    // BedrockProvider leaves credentials undefined and the AWS SDK's default
    // credential chain resolves them (env vars incl. AWS_SESSION_TOKEN, SSO,
    // IAM roles, AWS_PROFILE). We deliberately do not eagerly require
    // AWS_ACCESS_KEY_ID/SECRET here — that would break role- and profile-based
    // auth that the SDK can resolve on its own.
    const { BedrockProvider } = await import("./bedrock");
    return new BedrockProvider({
      apiKey: options.apiKey ?? "",
      secretKey: options.secretKey,
      model,
      timeout,
      region:
        options.region ?? process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1",
    });
  }

  // --- OpenAI / Anthropic ---
  const apiKey = options.apiKey ?? process.env[ENV_API_KEY[provider]];
  if (!apiKey) {
    throw new EvalConfigError(
      `Missing API key for ${provider}. Provide provider.apiKey or set ${ENV_API_KEY[provider]}.`,
    );
  }

  const baseUrl = options.baseUrl ?? process.env[ENV_BASE_URL[provider]];

  switch (provider) {
    case "openai": {
      const { OpenAIProvider } = await import("./openai");
      return new OpenAIProvider({ apiKey, model, timeout, baseUrl });
    }
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic");
      return new AnthropicProvider({ apiKey, model, timeout, baseUrl });
    }
  }
}
