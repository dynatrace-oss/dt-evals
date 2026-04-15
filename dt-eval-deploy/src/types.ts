import type { BuiltInMetric, EvalConfig, EvalInput, EvalResult } from "dt-eval-lib";

export interface EvaluateRequest {
  metric: BuiltInMetric;
  input: EvalInput;
  config: EvalConfig;
}

export interface EvaluateResponse {
  result: EvalResult;
}

export interface ErrorResponse {
  error: string;
  code?: string;
}
