import { EvalConfigError } from "../../errors";
import type { ProviderOptions } from "../types";
import type { LLMProvider } from "./types";

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6",
  vertex: "gemini-3.1-pro-preview",
  gemini: "gemini-3-flash-preview",
};

const ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  vertex: "GOOGLE_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

const ENV_BASE_URL_KEYS: Record<string, string> = {
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
};

export async function createProvider(options: ProviderOptions): Promise<LLMProvider> {
  const provider = options.provider;
  if (
    provider !== "openai" &&
    provider !== "anthropic" &&
    provider !== "vertex" &&
    provider !== "gemini"
  ) {
    throw new EvalConfigError(`Unknown provider: ${provider}`);
  }

  const timeout = options.timeout ?? 30000;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new EvalConfigError(`timeout must be a positive integer (ms), got ${timeout}`);
  }

  const model = options.model ?? DEFAULT_MODELS[provider];

  if (provider === "vertex" || provider === "gemini") {
    const apiKey = options.apiKey ?? process.env[ENV_KEYS[provider]];

    if (!apiKey) {
      throw new EvalConfigError(
        `Missing API key for ${provider}. Provide it via provider.apiKey or set the ${ENV_KEYS[provider]} environment variable.`,
      );
    }

    const { GoogleProvider } = await import("./google");
    return new GoogleProvider({ apiKey, model, timeout, vertexai: provider === "vertex" });
  }

  const apiKey = options.apiKey ?? process.env[ENV_KEYS[provider]];

  if (!apiKey) {
    throw new EvalConfigError(
      `Missing API key for ${provider}. Provide it via provider.apiKey or set the ${ENV_KEYS[provider]} environment variable.`,
    );
  }

  const baseUrl = options.baseUrl ?? process.env[ENV_BASE_URL_KEYS[provider]];
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
  }
}
