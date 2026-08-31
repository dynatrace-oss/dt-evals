import { EvalInputError } from "../../errors";
import type { EvalInput } from "../types";
import type { DeterministicOutcome, ExactMatchParams } from "./types";

export function exactMatch(input: EvalInput, params: ExactMatchParams): DeterministicOutcome {
  const resolvedExpected = params.expectedOutput ?? input.expectedOutput;
  if (resolvedExpected == null) {
    throw new EvalInputError(
      "exact_match requires expectedOutput (via params.expectedOutput or inputs.expectedOutput)",
    );
  }
  let actual = input.output;
  let expected = resolvedExpected;
  if (params.trim) {
    actual = actual.trim();
    expected = expected.trim();
  }
  if (params.caseSensitive === false) {
    actual = actual.toLowerCase();
    expected = expected.toLowerCase();
  }
  const passed = actual === expected;
  return {
    passed,
    summary: passed ? "Exact match" : "No exact match",
    reasoning: passed ? "Output equals expected output" : "Output does not equal expected output",
  };
}
