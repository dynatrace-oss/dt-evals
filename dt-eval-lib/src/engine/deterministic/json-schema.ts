import { EvalConfigError } from "../../errors";
import type { EvalInput } from "../types";
import type { DeterministicOutcome, JsonSchemaParams } from "./types";

export async function jsonSchema(
  input: EvalInput,
  params: JsonSchemaParams,
): Promise<DeterministicOutcome> {
  if (!params.schema) {
    throw new EvalConfigError("json_schema evaluator requires a 'schema'");
  }

  let data: unknown;
  try {
    data = JSON.parse(input.output);
  } catch {
    return { passed: false, summary: "Invalid JSON", reasoning: "Output is not valid JSON" };
  }

  let Ajv: typeof import("ajv").default;
  try {
    ({ default: Ajv } = await import("ajv"));
  } catch {
    throw new EvalConfigError(
      "json_schema evaluator requires the optional 'ajv' dependency to be installed",
    );
  }

  const validate = new Ajv({ allErrors: true, strict: false }).compile(params.schema);
  const passed = validate(data);
  const errors = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
  return {
    passed,
    summary: passed ? "Schema valid" : "Schema invalid",
    reasoning: passed ? "Output conforms to schema" : `Schema violations: ${errors ?? "unknown"}`,
  };
}
