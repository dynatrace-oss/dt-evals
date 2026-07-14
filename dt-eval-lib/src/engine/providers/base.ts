import type { LLMJudgeResponse, LLMProvider, ProviderConfig } from "./types";

export abstract class BaseProvider implements LLMProvider {
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly timeout: number;
  protected readonly baseUrl?: string;
  protected readonly apiVersion?: string;
  protected readonly region?: string;
  protected readonly secretKey?: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeout = config.timeout;
    this.baseUrl = config.baseUrl;
    this.apiVersion = config.apiVersion;
    this.region = config.region;
    this.secretKey = config.secretKey;
  }

  abstract call(prompt: string): Promise<LLMJudgeResponse>;
}
