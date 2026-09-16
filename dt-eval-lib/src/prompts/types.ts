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
  ToolSelection = "tool_selection",
  ToolInvocation = "tool_invocation",
  ToolResponseHandling = "tool_response_handling",
}

/** Identifier for the population-level drift detection metric. */
export const DRIFT_METRIC_ID = "drift";

/** Evaluation method. The evaluation engine defaults to "llm_as_judge" when omitted. */
export type EvaluatorMethod =
  | "llm_as_judge"
  | "exact_match"
  | "regex"
  | "must_not_match"
  | "json_schema"
  | "must_contain"
  | "must_not_contain"
  | "tool_called"
  | "tool_not_called";

export interface PromptDefinition {
  id: string;
  name: string;
  version: string;
  /** Description of what this metric evaluates */
  description: string;
  /** Evaluation method. The evaluation engine defaults to "llm_as_judge" when omitted. */
  method?: EvaluatorMethod;
  /** The evaluation prompt template (LLM judge only) — uses {{input}}, {{output}}, {{context}}, {{expectedOutput}}, {{trajectory}} placeholders */
  prompt?: string;
  /** Parameters for deterministic methods (exact_match, regex, must_contain, must_not_contain, json_schema, tool_called, tool_not_called) */
  params?: DeterministicParams;
  /** Which input fields this evaluator requires */
  requiredFields: (
    | "input"
    | "output"
    | "context"
    | "expectedOutput"
    | "trajectory"
    | "toolCalls"
  )[];
  /** The scoring scale to use */
  scoring: ScoringScale;
}
