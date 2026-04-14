import type { ScoringScale } from "../scoring/types";

export enum BuiltInMetric {
  Fluency = "fluency",
  Toxicity = "toxicity",
  Faithfulness = "faithfulness",
  Hallucination = "hallucination",
  PiiLeakage = "pii-leakage",
  Relevance = "relevance",
  FactualAccuracy = "factual-accuracy",
  Coherence = "coherence",
  ContextRelevance = "context-relevance",
  AnswerCompleteness = "answer-completeness",
  PromptInjection = "prompt-injection",
  Bias = "bias",
  SummarizationQuality = "summarization-quality",
  Conciseness = "conciseness",
}

/** Identifier for the population-level drift detection metric. */
export const DRIFT_METRIC_ID = "drift";

export interface PromptDefinition {
  id: string;
  name: string;
  version: string;
  /** Description of what this metric evaluates */
  description: string;
  /** The evaluation prompt template — uses {{input}}, {{output}}, {{context}}, {{expectedOutput}} placeholders */
  prompt: string;
  /** Which input fields this prompt requires */
  requiredFields: ("input" | "output" | "context" | "expectedOutput")[];
  /** The scoring scale to use */
  scoring: ScoringScale;
}
