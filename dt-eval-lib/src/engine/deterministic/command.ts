import { EvalConfigError } from "../../errors";
import type { EvalInput } from "../types";
import type { CommandParams } from "./types";

/**
 * The `command` verifier's params are validated at authoring time (so scenario
 * files parse and `skill validate` can catch mistakes early), but actually
 * running a shell command requires the sandbox executor — that ships in PR4.
 * Scoring a `command` criterion before then is a clear, deliberate error, not
 * a silent pass/fail.
 */
export function command(_input: EvalInput, _params: CommandParams): never {
  throw new EvalConfigError(
    "command verifier requires the sandbox executor (available in PR4); scenarios may declare it, but it cannot be scored yet",
  );
}
