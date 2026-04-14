// Public API — dt-eval-lib

// Main eval function
export { evaluate } from "./engine/index";
export type {
  EvalConfig,
  EvalInput,
  EvalResult,
  Provider,
  ProviderOptions,
  ScoringOptions,
} from "./engine/types";
// Errors
export {
  DtEvalError,
  EvalConfigError,
  EvalInputError,
  EvalMetricError,
  EvalResponseError,
  EvalTimeoutError,
} from "./errors";
// Prompt catalog
export { BuiltInMetric, DRIFT_METRIC_ID, getPrompt, listPrompts, createCustomPrompt, deleteCustomPrompt } from "./prompts/index";

export type { PromptDefinition } from "./prompts/types";
// Scoring
export { BINARY_SCALE, CONTINUOUS_SCALE, computeScore, LIKERT_SCALE } from "./scoring/index";
// Types
export type {
  Score,
  ScoringScale,
  ScoringScaleType,
} from "./scoring/types";
// Drift detection
export { detectDrift, detectDriftBatch } from "./drift";
export type { DriftOptions, DriftResult, DriftWindowStats } from "./drift";
