import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptDefinition } from "../src/prompts/types";
import { BINARY_SCALE } from "../src/scoring/index";

describe("json_schema validator cache", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("ajv");
  });

  it("compiles one validator when a definition evaluates multiple inputs", async () => {
    const validator = Object.assign(
      vi.fn(() => true),
      { errors: null },
    );
    const compile = vi.fn(() => validator);
    vi.doMock("ajv", () => ({
      default: class MockAjv {
        compile = compile;
      },
    }));
    const { evaluate } = await import("../src/engine/index");
    const definition: PromptDefinition = {
      id: "json",
      name: "json",
      version: "v1.0",
      description: "",
      method: "json_schema",
      params: { schema: { type: "object" } },
      requiredFields: ["output"],
      scoring: BINARY_SCALE,
    };

    await evaluate(definition, { input: "", output: "{}" }, {});
    await evaluate(definition, { input: "", output: '{"answer": 42}' }, {});

    expect(compile).toHaveBeenCalledOnce();
    expect(validator).toHaveBeenCalledTimes(2);
  });
});
