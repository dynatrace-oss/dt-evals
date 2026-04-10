import { EvalConfigError } from "../../errors";
import type { ProviderOptions } from "../types";
import type { LLMProvider } from "./types";

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-5.1",
  anthropic: "claude-sonnet-4-20250514",
  vertex: "gemini-2.5-flash",
};

const ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  vertex: "GOOGLE_API_KEY",
};

const ENV_BASE_URL_KEYS: Record<string, string> = {
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
};

const ENV_PROJECT_KEY = "GOOGLE_CLOUD_PROJECT";
const ENV_LOCATION_KEY = "GOOGLE_CLOUD_LOCATION";

export async function createProvider(options: ProviderOptions): Promise<LLMProvider> {
  const provider = options.provider;
  if (provider !== "openai" && provider !== "anthropic" && provider !== "vertex") {
    throw new EvalConfigError(`Unknown provider: ${provider}`);
  }

  const timeout = options.timeout ?? 30000;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new EvalConfigError(`timeout must be a positive integer (ms), got ${timeout}`);
  }

  const model = options.model ?? DEFAULT_MODELS[provider];

  if (provider === "vertex") {
    const project = options.project ?? process.env[ENV_PROJECT_KEY];
    const location = options.location ?? process.env[ENV_LOCATION_KEY];
    const apiKey = options.apiKey ?? process.env[ENV_KEYS[provider]];

    // Validate: need either (project AND location) or apiKey
    if ((project && !location) || (!project && location)) {
      throw new EvalConfigError(
        `Vertex AI ADC mode requires both project and location. ` +
          `You provided only ${project ? "project" : "location"}. ` +
          `Provide both or use apiKey instead.`,
      );
    }

    if (!project && !location && !apiKey) {
      throw new EvalConfigError(
        `Missing credentials for vertex. Provide either project + location (for Vertex AI with ADC) or apiKey (for Express Mode). ` +
          `Set via provider options or environment variables: ${ENV_PROJECT_KEY} + ${ENV_LOCATION_KEY}, or ${ENV_KEYS[provider]}.`,
      );
    }

    const { VertexProvider } = await import("./vertex");
    return new VertexProvider({
      apiKey: apiKey || "",
      model,
      timeout,
      project,
      location,
    });
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
