/** Raw structured response from the LLM judge */
export interface LLMJudgeResponse {
  scoreValue: number;
  summary: string;
  reasoning: string;
}

/** Configuration passed to provider constructors */
export interface ProviderConfig {
  /** API key. Empty string for Vertex AI / Bedrock when using Workload Identity / ADC / the AWS credential chain. */
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
  /** GCP project ID for Vertex AI. Falls back to GOOGLE_CLOUD_PROJECT env var. */
  project?: string;
  /** GCP region for Vertex AI (e.g. "global" or "us-central1"). Falls back to GOOGLE_CLOUD_LOCATION env var. */
  location?: string;
}

/** Interface that each LLM provider must implement */
export interface LLMProvider {
  /** Send the rendered evaluation prompt and get structured output */
  call(prompt: string): Promise<LLMJudgeResponse>;
}
