import { EvalConfigError } from "../../errors";
import type { EvalInput } from "../types";
import type { DeterministicOutcome, JsonSchemaParams } from "./types";

type ValidateFunction = import("ajv").ValidateFunction;
const validators = new WeakMap<object, Promise<ValidateFunction>>();

export async function jsonSchema(
  input: EvalInput,
  params: JsonSchemaParams,
): Promise<DeterministicOutcome> {
  if (!params.schema) {
    throw new EvalConfigError("json_schema evaluator requires a 'schema'");
  }

  const validate = await validatorFor(params.schema);
  let data: unknown;
  try {
    data = JSON.parse(input.output);
  } catch {
    return { passed: false, summary: "Invalid JSON", reasoning: "Output is not valid JSON" };
  }

  const passed = validate(data);
  const errors = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
  return {
    passed,
    summary: passed ? "Schema valid" : "Schema invalid",
    reasoning: passed ? "Output conforms to schema" : `Schema violations: ${errors ?? "unknown"}`,
  };
}

async function validatorFor(schema: object): Promise<ValidateFunction> {
  let pending = validators.get(schema);
  if (!pending) {
    pending = compileValidator(schema);
    validators.set(schema, pending);
  }
  try {
    return await pending;
  } catch (error) {
    validators.delete(schema);
    throw error;
  }
}

async function compileValidator(schema: object): Promise<ValidateFunction> {
  let Ajv: typeof import("ajv").default;
  try {
    ({ default: Ajv } = await import("ajv"));
  } catch {
    throw new EvalConfigError(
      "json_schema evaluator requires the optional 'ajv' dependency to be installed",
    );
  }
  try {
    return new Ajv({ allErrors: true, strict: false }).compile(schema);
  } catch (error) {
    throw new EvalConfigError(`Invalid JSON Schema: ${(error as Error).message}`);
  }
}
