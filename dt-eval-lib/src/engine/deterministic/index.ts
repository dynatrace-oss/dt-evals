import { EvalConfigError } from "../../errors";
import type {
  ContainsParams,
  EvaluatorMethod,
  ExactMatchParams,
  JsonSchemaParams,
  PromptDefinition,
  RegexParams,
} from "../../prompts/types";
import { BINARY_SCALE, computeScore } from "../../scoring/index";
import type { EvalInput, EvalResult } from "../types";
import { contains } from "./contains";
import { exactMatch } from "./exact-match";
import { jsonSchema } from "./json-schema";
import { assertPatternSafe } from "./redos";
import { regex } from "./regex";
import type { DeterministicOutcome } from "./types";

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
  const params = def.params ?? {};
  let outcome: DeterministicOutcome;
  switch (method) {
    case "exact_match":
      outcome = exactMatch(input, params as ExactMatchParams);
      break;
    case "regex": {
      const p = params as RegexParams;
      await assertPatternSafe(p.pattern, p.flags);
      outcome = regex(input, p, true);
      break;
    }
    case "must_not_match": {
      const p = params as RegexParams;
      await assertPatternSafe(p.pattern, p.flags);
      outcome = regex(input, p, false);
      break;
    }
    case "must_contain":
      outcome = contains(input, params as ContainsParams, true);
      break;
    case "must_not_contain":
      outcome = contains(input, params as ContainsParams, false);
      break;
    case "json_schema":
      outcome = await jsonSchema(input, params as JsonSchemaParams);
      break;
    default:
      throw new EvalConfigError(`Unknown deterministic method "${method}"`);
  }
  return {
    score: computeScore(outcome.passed ? 1 : 0, BINARY_SCALE, thresholdOverride),
    explanation: { summary: outcome.summary, reasoning: outcome.reasoning },
  };
}
