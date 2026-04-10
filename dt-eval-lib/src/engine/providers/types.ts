/** Raw structured response from the LLM judge */
export interface LLMJudgeResponse {
  scoreValue: number;
  summary: string;
  reasoning: string;
}

/** Configuration passed to provider constructors */
export interface ProviderConfig {
  apiKey?: string;
  model: string;
  timeout: number;
  baseUrl?: string;
  /** AWS region — used by Bedrock */
  region?: string;
}

/** Interface that each LLM provider must implement */
export interface LLMProvider {
  /** Send the rendered evaluation prompt and get structured output */
  call(prompt: string): Promise<LLMJudgeResponse>;
}
