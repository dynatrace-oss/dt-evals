/** Result of a deterministic scorer, before mapping onto the binary scale. */
export interface DeterministicOutcome {
  passed: boolean;
  summary: string;
  reasoning: string;
}

export interface ExactMatchParams {
  expectedOutput?: string;
  caseSensitive?: boolean;
  trim?: boolean;
}

export interface RegexParams {
  pattern: string;
  flags?: string;
}

/**
 * Params for the must_contain / must_not_contain methods.
 * - `mode: "any"` (default) — must_contain passes when ≥1 keyword is present;
 *   must_not_contain passes when none are present (blocklist).
 * - `mode: "all"` — must_contain passes when all keywords are present;
 *   must_not_contain passes unless all are present.
 * - `caseSensitive` defaults to false (case-insensitive match).
 */
export interface ContainsParams {
  keywords: string[];
  mode?: "any" | "all";
  caseSensitive?: boolean;
}

export interface JsonSchemaParams {
  schema: object;
}

/**
 * Params for the tool_called / tool_not_called methods.
 * - `mode: "any"` (default) — tool_called passes when ≥1 listed tool was called;
 *   tool_not_called passes when none of them were called.
 * - `mode: "all"` — tool_called passes when all listed tools were called;
 *   tool_not_called passes unless all of them were called.
 */
export interface ToolCalledParams {
  tools: string[];
  mode?: "any" | "all";
}

/** Parameters accepted by the deterministic methods. */
export type DeterministicParams =
  | ExactMatchParams
  | RegexParams
  | ContainsParams
  | JsonSchemaParams
  | ToolCalledParams;
