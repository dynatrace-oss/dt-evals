// Public API — dt-eval-lib

export type { DriftOptions, DriftResult, DriftWindowStats } from "./drift";
// Drift detection
export { detectDrift, detectDriftBatch } from "./drift";
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
export {
  BuiltInMetric,
  createCustomPrompt,
  DRIFT_METRIC_ID,
  deleteCustomPrompt,
  getPrompt,
  listPrompts,
} from "./prompts/index";
export type { PromptDefinition } from "./prompts/types";
// Scoring
export { BINARY_SCALE, CONTINUOUS_SCALE, computeScore, LIKERT_SCALE } from "./scoring/index";
// Types
export type {
  Score,
  ScoringScale,
  ScoringScaleType,
} from "./scoring/types";
