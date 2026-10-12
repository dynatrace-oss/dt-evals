import type { LLMJudgeResponse, LLMProvider, ProviderConfig } from "./types";

/** Sampling temperature sent when provider.temperature is unset. */
const DEFAULT_TEMPERATURE = 0;

// Models (baseUrl + model) that rejected DEFAULT_TEMPERATURE. Module-level because a provider
// instance is created per evaluate() call; lets later calls skip the failing first request.
const temperatureUnsupported = new Set<string>();

const isUnsupportedTemperatureError = (error: unknown): boolean => {
  const err = error as { status?: unknown; message?: unknown } | null;
  return err?.status === 400 && /temperature/i.test(String(err.message));
};

export abstract class BaseProvider implements LLMProvider {
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly timeout: number;
  protected readonly baseUrl?: string;
  protected readonly temperature?: number;
  protected readonly apiVersion?: string;
  protected readonly region?: string;
  protected readonly secretKey?: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeout = config.timeout;
    this.baseUrl = config.baseUrl;
    this.temperature = config.temperature;
    this.apiVersion = config.apiVersion;
    this.region = config.region;
    this.secretKey = config.secretKey;
  }

  /**
   * Sends with the configured temperature, or DEFAULT_TEMPERATURE when unset. Reasoning models
   * (o-series, gpt-5.x) only accept their own default: if the default is rejected, retry once
   * without it and skip it for that model from then on. A configured temperature is never dropped.
   */
  protected async withTemperature<T>(send: (temperature?: number) => Promise<T>): Promise<T> {
    if (this.temperature !== undefined) return send(this.temperature);

    const key = `${this.baseUrl ?? ""}|${this.model}`;
    if (temperatureUnsupported.has(key)) return send(undefined);

    try {
      return await send(DEFAULT_TEMPERATURE);
    } catch (error) {
      if (!isUnsupportedTemperatureError(error)) throw error;
      temperatureUnsupported.add(key);
      return send(undefined);
    }
  }

  abstract call(prompt: string): Promise<LLMJudgeResponse>;
}
