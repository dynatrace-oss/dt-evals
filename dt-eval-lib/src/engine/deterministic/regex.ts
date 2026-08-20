import { EvalConfigError, EvalInputError } from "../../errors";
import type { EvalInput } from "../types";
import type { DeterministicOutcome, RegexParams } from "./types";

/**
 * Hard cap on the text fed to the native regex engine. Oversized output is
 * rejected (not truncated) — truncating would silently miss a pattern in the
 * tail, e.g. must_not_match failing to detect PII past the cap.
 */
const MAX_INPUT_LENGTH = 100_000;

/**
 * Native-RegExp check shared by the regex / must_not_match methods.
 * `mustMatch` selects the direction: true → output should match the pattern
 * (format check); false → output should NOT match (e.g. PII / harmful-word
 * detection, where a match is a failure).
 */
export function regex(
  input: EvalInput,
  params: RegexParams,
  mustMatch: boolean,
): DeterministicOutcome {
  if (!params.pattern) {
    throw new EvalConfigError("regex/must_not_match requires a 'pattern'");
  }
  let re: RegExp;
  try {
    re = new RegExp(params.pattern, params.flags);
  } catch (error) {
    throw new EvalConfigError(`Invalid regex pattern: ${(error as Error).message}`);
  }
  if (input.output.length > MAX_INPUT_LENGTH) {
    throw new EvalInputError(
      `Output length ${input.output.length} exceeds the ${MAX_INPUT_LENGTH}-char limit for regex/must_not_match; refusing to run to avoid a truncated (incorrect) result`,
    );
  }
  const matched = re.test(input.output);
  const passed = mustMatch ? matched : !matched;
  const pat = `/${params.pattern}/${params.flags ?? ""}`;
  return {
    passed,
    summary: passed ? "Pattern constraint satisfied" : "Pattern constraint violated",
    reasoning: mustMatch
      ? `${pat} ${matched ? "matched" : "did not match"} output`
      : `${pat} ${matched ? "matched (disallowed)" : "did not match"} output`,
  };
}
