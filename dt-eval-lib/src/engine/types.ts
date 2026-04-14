import type { Score } from "../scoring/types";

/** Provider selection */
export type Provider = "openai" | "anthropic" | "vertex" | "gemini";

/** Provider-related configuration */
export interface ProviderOptions {
  /** Which LLM provider to use */
  provider: Provider;
  /** API key — falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY env vars */
  apiKey?: string;
  /** Base URL for the provider API — falls back to OPENAI_BASE_URL / ANTHROPIC_BASE_URL env vars */
  baseUrl?: string;
  /** Model override — defaults to gpt-4.1 / claude-sonnet-4-6 / gemini-2.5-pro (vertex) / gemini-2.5-flash (gemini) */
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
