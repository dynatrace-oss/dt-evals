import type { Score } from "../scoring/types";

/** Provider selection */
export type Provider = "openai" | "anthropic" | "azure-openai" | "gemini" | "bedrock";

/** Provider-related configuration */
export interface ProviderOptions {
  /** Which LLM provider to use */
  provider: Provider;
  /** API key — falls back to provider-specific env var (not used for bedrock) */
  apiKey?: string;
  /** Base URL / endpoint for the provider API */
  baseUrl?: string;
  /** Model override — falls back to provider-specific default */
  model?: string;
  /** Request timeout in ms — default 30000 */
  timeout?: number;
  /** Max retries on transient errors — default 2 */
  maxRetries?: number;
  /** AWS region for Bedrock — falls back to AWS_REGION env var */
  region?: string;
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
