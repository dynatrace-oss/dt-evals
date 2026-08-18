import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptDefinition } from "../src/prompts/types";
import { BINARY_SCALE } from "../src/scoring/index";

/** A regex-method definition for the ReDoS fail-closed tests. */
function regexDef(pattern: string): PromptDefinition {
  return {
    id: "t",
    name: "t",
    version: "v1.0",
    description: "",
    method: "regex",
    params: { pattern } as never,
    requiredFields: ["output"],
    scoring: BINARY_SCALE,
  };
}

describe("regex ReDoS guard fails closed", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("recheck");
  });

  it("rejects when recheck is not installed", async () => {
    vi.doMock("recheck", () => {
      throw new Error("Cannot find module 'recheck'");
    });
    const { evaluate } = await import("../src/engine/index");
    await expect(evaluate(regexDef("abc"), { input: "", output: "abc" }, {})).rejects.toThrow(
      /recheck/,
    );
  });

  it("rejects when analysis is inconclusive (unknown)", async () => {
    vi.doMock("recheck", () => ({ check: async () => ({ status: "unknown" }) }));
    const { evaluate } = await import("../src/engine/index");
    await expect(evaluate(regexDef("abc"), { input: "", output: "abc" }, {})).rejects.toThrow(
      /could not be verified/,
    );
  });

  it("runs only when the analyzer reports safe", async () => {
    vi.doMock("recheck", () => ({ check: async () => ({ status: "safe" }) }));
    const { evaluate } = await import("../src/engine/index");
    const r = await evaluate(regexDef("abc"), { input: "", output: "abc" }, {});
    expect(r.score.label).toBe("pass");
  });
});
