import type { ScoringScale } from "../scoring/types";

export enum BuiltInMetric {
  Fluency = "fluency",
  Toxicity = "toxicity",
  Faithfulness = "faithfulness",
  Hallucination = "hallucination",
  PiiLeakage = "pii-leakage",
  Relevance = "relevance",
  FactualAccuracy = "factual-accuracy",
  UserFrustration = "user-frustration",
  ContextRelevance = "context-relevance",
  AnswerCompleteness = "answer-completeness",
  PromptInjection = "prompt-injection",
  Bias = "bias",
  SummarizationQuality = "summarization-quality",
  Conciseness = "conciseness",
}

/** Identifier for the population-level drift detection metric. */
export const DRIFT_METRIC_ID = "drift";

/** How an evaluator computes its score. Defaults to "llm_as_judge" when omitted. */
export type EvaluatorMethod =
  | "llm_as_judge"
  | "exact_match"
  | "regex"
  | "must_not_match"
  | "json_schema"
  | "must_contain"
  | "must_not_contain";

export interface ExactMatchParams {
  caseSensitive?: boolean;
  trim?: boolean;
}

export interface RegexParams {
  pattern: string;
  flags?: string;
}

/**
 * Params for the must_contain / must_not_contain methods.
 * - `mode: "any"` (default) — must_contain passes when ≥1 keyword is present;
 *   must_not_contain passes when none are present (blocklist).
 * - `mode: "all"` — must_contain passes when all keywords are present;
 *   must_not_contain passes unless all are present.
 * - `caseSensitive` defaults to false (case-insensitive match).
 */
export interface ContainsParams {
  keywords: string[];
  mode?: "any" | "all";
  caseSensitive?: boolean;
}

export interface JsonSchemaParams {
  schema: object;
}

export type DeterministicParams =
  | ExactMatchParams
  | RegexParams
  | ContainsParams
  | JsonSchemaParams;

export interface PromptDefinition {
  id: string;
  name: string;
  version: string;
  /** Description of what this metric evaluates */
  description: string;
  /** Evaluation method — defaults to "llm_as_judge" when omitted */
  method?: EvaluatorMethod;
  /** The evaluation prompt template (LLM judge only) — uses {{input}}, {{output}}, {{context}}, {{expectedOutput}} placeholders */
  prompt?: string;
  /** Parameters for deterministic methods (exact_match, regex, must_contain, must_not_contain, json_schema) */
  params?: DeterministicParams;
  /** Which input fields this evaluator requires */
  requiredFields: ("input" | "output" | "context" | "expectedOutput")[];
  /** The scoring scale to use */
  scoring: ScoringScale;
}
