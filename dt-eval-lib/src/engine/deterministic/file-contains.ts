import { EvalConfigError, EvalInputError } from "../../errors";
import type { EvalInput } from "../types";
import { assertPatternSafe } from "./redos";
import type { DeterministicOutcome, FileContainsParams } from "./types";

/** Mirrors regex.ts's cap — same rationale (reject, don't silently truncate). */
const MAX_CONTENT_LENGTH = 100_000;

/**
 * Workspace file-content check: looks up `input.workspace[params.path]` and
 * checks it via substring (`text`) or regex (`pattern`) match. Fail-closed
 * when the workspace or the file is absent.
 */
export async function fileContains(
  input: EvalInput,
  params: FileContainsParams,
): Promise<DeterministicOutcome> {
  const workspace = input.workspace ?? {};
  const content = workspace[params.path];
  if (content === undefined) {
    return {
      passed: false,
      summary: "File not found",
      reasoning: `"${params.path}" was not found in the workspace (${Object.keys(workspace).length} file(s) present)`,
    };
  }

  if (params.text !== undefined) {
    const passed = content.includes(params.text);
    return {
      passed,
      summary: passed ? "File contains text" : "File does not contain text",
      reasoning: `"${params.path}" ${passed ? "contains" : "does not contain"} "${params.text}"`,
    };
  }

  if (params.pattern !== undefined) {
    await assertPatternSafe(params.pattern);
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new EvalInputError(
        `File "${params.path}" length ${content.length} exceeds the ${MAX_CONTENT_LENGTH}-char limit for file_contains; refusing to run to avoid a truncated (incorrect) result`,
      );
    }
    const re = new RegExp(params.pattern);
    const passed = re.test(content);
    return {
      passed,
      summary: passed ? "File matches pattern" : "File does not match pattern",
      reasoning: `"${params.path}" ${passed ? "matched" : "did not match"} /${params.pattern}/`,
    };
  }

  throw new EvalConfigError("file_contains requires exactly one of 'text' or 'pattern'");
}
