import { EvalConfigError } from "../../errors";
import type { ContainsParams } from "../../prompts/types";
import type { EvalInput } from "../types";
import type { DeterministicOutcome } from "./types";

/**
 * Keyword presence check shared by the must_contain / must_not_contain methods.
 * `mustContain` selects the direction: true → output should contain the
 * keyword(s); false → output should not (blocklist).
 */
export function contains(
  input: EvalInput,
  params: ContainsParams,
  mustContain: boolean,
): DeterministicOutcome {
  const keywords = params.keywords ?? [];
  if (keywords.length === 0) {
    throw new EvalConfigError(
      "must_contain/must_not_contain requires a non-empty 'keywords' array",
    );
  }
  const mode = params.mode ?? "any";
  const caseSensitive = params.caseSensitive ?? false;
  const haystack = caseSensitive ? input.output : input.output.toLowerCase();
  const missing = keywords.filter((k) => !haystack.includes(caseSensitive ? k : k.toLowerCase()));
  const present = keywords.length - missing.length;

  // must_contain:     any → ≥1 present;        all → all present.
  // must_not_contain: any → none present;      all → not all present.
  const passed = mustContain
    ? mode === "all"
      ? missing.length === 0
      : present > 0
    : mode === "all"
      ? present < keywords.length
      : present === 0;

  const label = mustContain ? "must_contain" : "must_not_contain";
  return {
    passed,
    summary: passed ? "Keyword constraint satisfied" : "Keyword constraint violated",
    reasoning: `${label} (mode=${mode}); ${present}/${keywords.length} present${
      missing.length ? `; absent: ${missing.join(", ")}` : ""
    }`,
  };
}
