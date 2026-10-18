import type { DeterministicParams } from "../engine/deterministic/types";
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
  OutputPromptInjection = "output-prompt-injection",
  Bias = "bias",
  SummarizationQuality = "summarization-quality",
  Conciseness = "conciseness",
}

/** Identifier for the population-level drift detection metric. */
export const DRIFT_METRIC_ID = "drift";

/**
 * Display polarity of the metric's named concept. Presentation metadata only —
 * scores stay canonical (high = pass) and pass/fail is unaffected.
 * "positive" = higher is better, "negative" = lower is better (risk metrics).
 * Absent is treated as "neutral", which defaults to higher-is-better.
 */
export type ScoreDirection = "positive" | "negative" | "neutral";

/** Evaluation method. The evaluation engine defaults to "llm_as_judge" when omitted. */
export type EvaluatorMethod =
  | "llm_as_judge"
  | "exact_match"
  | "regex"
  | "must_not_match"
  | "json_schema"
  | "must_contain"
  | "must_not_contain";

export interface PromptDefinition {
  id: string;
  name: string;
  version: string;
  /** Description of what this metric evaluates */
  description: string;
  /** Evaluation method. The evaluation engine defaults to "llm_as_judge" when omitted. */
  method?: EvaluatorMethod;
  /** The evaluation prompt template (LLM judge only) — uses {{input}}, {{output}}, {{context}}, {{expectedOutput}} placeholders */
  prompt?: string;
  /** Parameters for deterministic methods (exact_match, regex, must_contain, must_not_contain, json_schema) */
  params?: DeterministicParams;
  /** Which input fields this evaluator requires */
  requiredFields: ("input" | "output" | "context" | "expectedOutput")[];
  /** The scoring scale to use */
  scoring: ScoringScale;
  /** Display polarity of the metric's named concept. Defaults to higher-is-better when omitted. */
  direction?: ScoreDirection;
}
