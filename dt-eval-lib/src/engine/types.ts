import type { Score } from "../scoring/types";

/** Provider selection */
export type Provider = "openai" | "anthropic" | "vertex" | "gemini" | "azure-openai" | "bedrock";

/** Provider-related configuration */
export interface ProviderOptions {
  /** Which LLM provider to use */
  provider: Provider;
  /** API key — falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY env vars */
  apiKey?: string;
  /** Base URL for the provider API — falls back to OPENAI_BASE_URL / ANTHROPIC_BASE_URL env vars */
  baseUrl?: string;
  /** Azure OpenAI api-version (e.g. "2026-04-01-preview"). Only used for Azure endpoints. */
  apiVersion?: string;
  /** AWS region for Bedrock (e.g. "us-east-1"). Only used for bedrock provider. */
  region?: string;
  /** AWS secret access key for Bedrock. Paired with apiKey (access key ID). */
  secretKey?: string;
  /** GCP project ID for Vertex AI. Falls back to GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT env vars. */
  project?: string;
  /** GCP region for Vertex AI (e.g. "global" or "us-central1"). Falls back to GOOGLE_CLOUD_LOCATION env var. Default: global. */
  location?: string;
  /** Model override — see DEFAULT_MODELS in src/engine/providers/index.ts for per-provider defaults */
  model?: string;
  /** Request timeout in ms — default 30000 */
  timeout?: number;
  /** Max retries on transient errors — default 2 */
  maxRetries?: number;
}

/** Scoring-related configuration */
export interface ScoringOptions {
  /** Override the metric's default scoring threshold */
  thresholdOverride?: number;
}

/** Top-level evaluation configuration */
export interface EvalConfig {
  provider: ProviderOptions;
  scoring?: ScoringOptions;
}

/** Input to an evaluation */
export interface EvalInput {
  /** The input/question sent to the LLM */
  input: string;
  /** The LLM's output to evaluate */
  output: string;
  /** Optional context (e.g., retrieved documents for RAG) */
  context?: string;
  /** Optional expected/reference output */
  expectedOutput?: string;
}

/** Result of an evaluation */
export interface EvalResult {
  score: Score;
  explanation: {
    summary: string;
    reasoning: string;
  };
}
