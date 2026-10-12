import type { EvalInput } from "../types";
import type { DeterministicOutcome, FileExistsParams } from "./types";

/**
 * Workspace file-presence check. Fail-closed: a missing `input.workspace`
 * (no sandbox run recorded) is treated as an empty workspace, not a skip.
 */
export function fileExists(input: EvalInput, params: FileExistsParams): DeterministicOutcome {
  const workspace = input.workspace ?? {};
  const passed = Object.hasOwn(workspace, params.path);
  return {
    passed,
    summary: passed ? "File exists" : "File does not exist",
    reasoning: passed
      ? `"${params.path}" is present in the workspace`
      : `"${params.path}" was not found in the workspace (${Object.keys(workspace).length} file(s) present)`,
  };
}
