import { EvalConfigError } from "../../errors";
import type { EvalInput } from "../types";
import type { DeterministicOutcome, ToolCalledParams } from "./types";

/**
 * Tool-call presence check shared by the tool_called / tool_not_called methods.
 * `positive` selects the direction: true → the listed tool(s) should have been
 * called; false → they should not have been (blocklist).
 */
export function toolCalled(
  input: EvalInput,
  params: ToolCalledParams,
  positive: boolean,
): DeterministicOutcome {
  const tools = params.tools ?? [];
  if (tools.length === 0) {
    throw new EvalConfigError(
      `${positive ? "tool_called" : "tool_not_called"} requires a non-empty 'tools' array`,
    );
  }
  const mode = params.mode ?? "any";
  const called = new Set((input.toolCalls ?? []).map((c) => c.name));
  const missing = tools.filter((t) => !called.has(t));
  const present = tools.length - missing.length;

  // tool_called:     any → ≥1 present;      all → all present.
  // tool_not_called: any → none present;    all → not all present.
  const passed = positive
    ? mode === "all"
      ? missing.length === 0
      : present > 0
    : mode === "all"
      ? present < tools.length
      : present === 0;

  const label = positive ? "tool_called" : "tool_not_called";
  return {
    passed,
    summary: passed ? "Tool-call constraint satisfied" : "Tool-call constraint violated",
    reasoning: `${label} (mode=${mode}); ${present}/${tools.length} called${
      missing.length ? `; not called: ${missing.join(", ")}` : ""
    }`,
  };
}
