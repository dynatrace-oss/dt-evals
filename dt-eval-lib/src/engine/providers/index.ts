import { EvalConfigError } from "../../errors";
import type { ProviderOptions } from "../types";
import type { LLMProvider } from "./types";

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.1",
  anthropic: "claude-sonnet-4-20250514",
  "azure-openai": "gpt-4o", // deployment name; users should override with their deployment
  gemini: "gemini-2.0-flash",
  bedrock: "anthropic.claude-sonnet-4-5-20251001-v1:0",
};

const ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "azure-openai": "AZURE_OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  // bedrock: no single API key — uses AWS credential chain
};

const ENV_BASE_URL_KEYS: Record<string, string> = {
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
  "azure-openai": "AZURE_OPENAI_ENDPOINT",
};

const SUPPORTED_PROVIDERS = new Set(Object.keys(DEFAULT_MODELS));

export async function createProvider(options: ProviderOptions): Promise<LLMProvider> {
  const provider = options.provider;
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new EvalConfigError(`Unknown provider: ${provider}. Supported: ${[...SUPPORTED_PROVIDERS].join(", ")}`);
  }

  const timeout = options.timeout ?? 30000;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new EvalConfigError(`timeout must be a positive integer (ms), got ${timeout}`);
  }

  const model = options.model ?? DEFAULT_MODELS[provider];
  const baseUrl = options.baseUrl ?? (ENV_BASE_URL_KEYS[provider] ? process.env[ENV_BASE_URL_KEYS[provider]] : undefined);

  // Bedrock uses the AWS credential chain — no API key required
  if (provider === "bedrock") {
    const region = options.region ?? process.env["AWS_REGION"];
    const { BedrockProvider } = await import("./bedrock");
    return new BedrockProvider({ model, timeout, baseUrl, region });
  }

  // All other providers require an API key
  const envKey = ENV_KEYS[provider];

  // Gemini also accepts GOOGLE_API_KEY as a fallback
  const apiKey =
    options.apiKey ??
    (provider === "gemini"
      ? (process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"])
      : process.env[envKey]);

  if (!apiKey) {
    const envHint = provider === "gemini" ? "GEMINI_API_KEY or GOOGLE_API_KEY" : envKey;
    throw new EvalConfigError(
      `Missing API key for ${provider}. Provide it via provider.apiKey or set the ${envHint} environment variable.`,
    );
  }

  const providerConfig = { apiKey, model, timeout, baseUrl };

  switch (provider) {
    case "openai": {
      const { OpenAIProvider } = await import("./openai");
      return new OpenAIProvider(providerConfig);
    }
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic");
      return new AnthropicProvider(providerConfig);
    }
    case "azure-openai": {
      if (!baseUrl) {
        throw new EvalConfigError(
          "azure-openai requires an endpoint. Provide provider.baseUrl or set AZURE_OPENAI_ENDPOINT.",
        );
      }
      const { AzureOpenAIProvider } = await import("./azure-openai");
      return new AzureOpenAIProvider({ ...providerConfig, baseUrl });
    }
    case "gemini": {
      const { GeminiProvider } = await import("./gemini");
      return new GeminiProvider(providerConfig);
    }
  }
}

