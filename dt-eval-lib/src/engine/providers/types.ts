/** Raw structured response from the LLM judge */
export interface LLMJudgeResponse {
  scoreValue: number;
  summary: string;
  reasoning: string;
}

/** Configuration passed to provider constructors */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  timeout: number;
  baseUrl?: string;
  /** Azure OpenAI api-version (e.g. "2026-04-01-preview"). Only used for Azure endpoints. */
  apiVersion?: string;
  /** AWS region for Bedrock. */
  region?: string;
  /** AWS secret access key for Bedrock. Paired with apiKey (access key ID). */
  secretKey?: string;
}

/** Interface that each LLM provider must implement */
export interface LLMProvider {
  /** Send the rendered evaluation prompt and get structured output */
  call(prompt: string): Promise<LLMJudgeResponse>;
}
