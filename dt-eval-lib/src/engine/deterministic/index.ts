import { EvalConfigError } from "../../errors";
import type { EvaluatorMethod, PromptDefinition } from "../../prompts/types";
import { BINARY_SCALE, computeScore } from "../../scoring/index";
import type { EvalInput, EvalResult } from "../types";
import { contains } from "./contains";
import { exactMatch } from "./exact-match";
import { jsonSchema } from "./json-schema";
import { assertPatternSafe } from "./redos";
import { regex } from "./regex";
import type {
  ContainsParams,
  DeterministicOutcome,
  ExactMatchParams,
  JsonSchemaParams,
  RegexParams,
} from "./types";

/** True for every method except the LLM judge. */
export function isDeterministic(method: EvaluatorMethod): boolean {
  return method !== "llm_as_judge";
}

/** Run a deterministic evaluator and map its boolean outcome onto the binary scale. */
export async function runScorer(
  method: EvaluatorMethod,
  def: PromptDefinition,
  input: EvalInput,
  thresholdOverride?: number,
): Promise<EvalResult> {
  const params = readParams(def);
  let outcome: DeterministicOutcome;
  switch (method) {
    case "exact_match":
      outcome = exactMatch(input, exactMatchParams(params));
      break;
    case "regex": {
      const p = regexParams(params, method);
      await assertPatternSafe(p.pattern, p.flags);
      outcome = regex(input, p, true);
      break;
    }
    case "must_not_match": {
      const p = regexParams(params, method);
      await assertPatternSafe(p.pattern, p.flags);
      outcome = regex(input, p, false);
      break;
    }
    case "must_contain":
      outcome = contains(input, containsParams(params, method), true);
      break;
    case "must_not_contain":
      outcome = contains(input, containsParams(params, method), false);
      break;
    case "json_schema":
      outcome = await jsonSchema(input, jsonSchemaParams(params));
      break;
    default:
      throw new EvalConfigError(`Unknown deterministic method "${method}"`);
  }
  return {
    score: computeScore(outcome.passed ? 1 : 0, BINARY_SCALE, thresholdOverride),
    explanation: { summary: outcome.summary, reasoning: outcome.reasoning },
  };
}

function readParams(def: PromptDefinition): Record<string, unknown> {
  const params: unknown = def.params ?? {};
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new EvalConfigError(`Metric "${def.id}" params must be an object`);
  }
  return params as Record<string, unknown>;
}

function exactMatchParams(params: Record<string, unknown>): ExactMatchParams {
  const expectedOutput = params.expectedOutput;
  if (expectedOutput !== undefined && typeof expectedOutput !== "string") {
    throw new EvalConfigError("exact_match 'expectedOutput' must be a string");
  }
  return {
    ...(expectedOutput !== undefined ? { expectedOutput } : {}),
    caseSensitive: optionalBoolean(params, "caseSensitive", "exact_match"),
    trim: optionalBoolean(params, "trim", "exact_match"),
  };
}

function regexParams(params: Record<string, unknown>, method: string): RegexParams {
  const pattern = params.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new EvalConfigError(`${method} requires a non-empty string 'pattern'`);
  }
  const flags = params.flags;
  if (flags !== undefined && typeof flags !== "string") {
    throw new EvalConfigError(`${method} 'flags' must be a string`);
  }
  return { pattern, ...(flags !== undefined ? { flags } : {}) };
}

function containsParams(params: Record<string, unknown>, method: string): ContainsParams {
  const keywords = params.keywords;
  if (
    !Array.isArray(keywords) ||
    keywords.length === 0 ||
    keywords.some((keyword) => typeof keyword !== "string" || keyword.length === 0)
  ) {
    throw new EvalConfigError(`${method} requires a non-empty string 'keywords' array`);
  }
  const mode = params.mode;
  if (mode !== undefined && mode !== "any" && mode !== "all") {
    throw new EvalConfigError(`${method} 'mode' must be "any" or "all"`);
  }
  return {
    keywords,
    ...(mode !== undefined ? { mode } : {}),
    caseSensitive: optionalBoolean(params, "caseSensitive", method),
  };
}

function jsonSchemaParams(params: Record<string, unknown>): JsonSchemaParams {
  const schema = params.schema;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new EvalConfigError("json_schema requires an object 'schema'");
  }
  return { schema };
}

function optionalBoolean(
  params: Record<string, unknown>,
  key: string,
  method: string,
): boolean | undefined {
  const value = params[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw new EvalConfigError(`${method} '${key}' must be a boolean`);
  }
  return value;
}
