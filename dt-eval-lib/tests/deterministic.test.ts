import { describe, expect, it } from "vitest";
import { evaluate } from "../src/engine/index";
import type { EvalInput } from "../src/engine/types";
import type { PromptDefinition } from "../src/prompts/types";
import { BINARY_SCALE } from "../src/scoring/index";

const base = { id: "test", name: "Test", version: "v1.0", description: "", scoring: BINARY_SCALE };

function run(def: Partial<PromptDefinition>, input: Partial<EvalInput>) {
  return evaluate(
    { ...base, requiredFields: ["output"], ...def } as PromptDefinition,
    { input: "", output: "", ...input },
    {},
  );
}

describe("deterministic evaluators", () => {
  it("exact_match: equal → pass", async () => {
    const r = await run(
      { method: "exact_match", requiredFields: ["output", "expectedOutput"] },
      { output: "hello", expectedOutput: "hello" },
    );
    expect(r.score).toEqual({ value: 1, label: "pass" });
  });

  it("exact_match: differs → fail", async () => {
    const r = await run(
      { method: "exact_match", requiredFields: ["output", "expectedOutput"] },
      { output: "hello", expectedOutput: "world" },
    );
    expect(r.score.label).toBe("fail");
  });

  it("exact_match: rejects a missing expected output even when requiredFields omits it", async () => {
    await expect(
      run({ method: "exact_match", requiredFields: ["output"] }, { output: "" }),
    ).rejects.toThrow(/expectedOutput/);
  });

  it("exact_match: trim + caseSensitive:false → pass", async () => {
    const r = await run(
      {
        method: "exact_match",
        params: { trim: true, caseSensitive: false },
        requiredFields: ["output", "expectedOutput"],
      },
      { output: "  Hello ", expectedOutput: "hello" },
    );
    expect(r.score.label).toBe("pass");
  });

  it("regex: match → pass", async () => {
    const r = await run(
      { method: "regex", params: { pattern: "^\\d{3}-\\d{4}$" } },
      { output: "123-4567" },
    );
    expect(r.score.label).toBe("pass");
  });

  it("regex: no match → fail", async () => {
    const r = await run({ method: "regex", params: { pattern: "^\\d+$" } }, { output: "abc" });
    expect(r.score.label).toBe("fail");
  });

  it("regex: rejects params for a different method", async () => {
    await expect(
      run({ method: "regex", params: { keywords: ["x"] } }, { output: "x" }),
    ).rejects.toThrow(/pattern/);
  });

  it("must_not_match: no match → pass (PII-clean output)", async () => {
    const r = await run(
      { method: "must_not_match", params: { pattern: "\\d{3}-\\d{2}-\\d{4}" } },
      { output: "no ssn here" },
    );
    expect(r.score.label).toBe("pass");
  });

  it("must_not_match: match → fail (PII detected)", async () => {
    const r = await run(
      { method: "must_not_match", params: { pattern: "\\d{3}-\\d{2}-\\d{4}" } },
      { output: "my ssn is 123-45-6789" },
    );
    expect(r.score.label).toBe("fail");
  });

  it("regex/must_not_match: rejects oversized output instead of silently truncating", async () => {
    // A banned token past the 100k cap must not be missed → we reject, not truncate.
    const oversized = `${"a".repeat(100_001)}123-45-6789`;
    await expect(
      run(
        { method: "must_not_match", params: { pattern: "\\d{3}-\\d{2}-\\d{4}" } },
        { output: oversized },
      ),
    ).rejects.toThrow(/exceeds the 100000-char limit/);
  });

  it("regex: rejects a ReDoS-vulnerable pattern (catastrophic backtracking)", async () => {
    await expect(
      run({ method: "must_not_match", params: { pattern: "^(a+)+$" } }, { output: "aaaaaaaaaa!" }),
    ).rejects.toThrow(/ReDoS/);
  });

  it("regex: allows a safe (linear) pattern", async () => {
    const r = await run(
      { method: "must_not_match", params: { pattern: "\\d{3}-\\d{2}-\\d{4}" } },
      { output: "clean output" },
    );
    expect(r.score.label).toBe("pass");
  });

  it("thresholdOverride is honored for deterministic methods", async () => {
    const def = {
      ...base,
      requiredFields: ["output"],
      method: "must_contain",
      params: { keywords: ["zzz"] },
    } as PromptDefinition;
    // keyword absent → raw value 0. Default binary threshold (1) ⇒ fail.
    expect((await evaluate(def, { input: "", output: "no match" }, {})).score.label).toBe("fail");
    // Override threshold to 0 ⇒ 0 >= 0 ⇒ pass (proves the override is threaded, not dropped).
    expect(
      (
        await evaluate(
          def,
          { input: "", output: "no match" },
          { scoring: { thresholdOverride: 0 } },
        )
      ).score.label,
    ).toBe("pass");
  });

  it("must_contain: mode any → pass", async () => {
    const r = await run(
      { method: "must_contain", params: { keywords: ["cat", "dog"], mode: "any" } },
      { output: "I have a dog" },
    );
    expect(r.score.label).toBe("pass");
  });

  it("must_contain: mode all → fail when one missing", async () => {
    const r = await run(
      { method: "must_contain", params: { keywords: ["cat", "dog"], mode: "all" } },
      { output: "I have a dog" },
    );
    expect(r.score.label).toBe("fail");
  });

  it("must_contain: case-insensitive by default → pass", async () => {
    const r = await run(
      { method: "must_contain", params: { keywords: ["DOG"] } },
      { output: "i have a dog" },
    );
    expect(r.score.label).toBe("pass");
  });

  it("must_contain: rejects an unsupported mode at runtime", async () => {
    await expect(
      run(
        { method: "must_contain", params: { keywords: ["dog"], mode: "invalid" } },
        { output: "dog" },
      ),
    ).rejects.toThrow(/mode/);
  });

  it("must_not_contain: keyword absent → pass (blocklist)", async () => {
    const r = await run(
      { method: "must_not_contain", params: { keywords: ["i cannot help"], mode: "any" } },
      { output: "Sure, here is the answer." },
    );
    expect(r.score.label).toBe("pass");
  });

  it("must_not_contain: keyword present → fail (blocklist)", async () => {
    const r = await run(
      { method: "must_not_contain", params: { keywords: ["i cannot help"], mode: "any" } },
      { output: "Sorry, i cannot help with that." },
    );
    expect(r.score.label).toBe("fail");
  });

  it("must_not_contain: mode all → pass unless every keyword present", async () => {
    const r = await run(
      { method: "must_not_contain", params: { keywords: ["cat", "dog"], mode: "all" } },
      { output: "I have a dog" },
    );
    expect(r.score.label).toBe("pass");
  });

  it("json_schema: conforms → pass", async () => {
    const r = await run(
      {
        method: "json_schema",
        params: {
          schema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      },
      { output: '{"name":"ada"}' },
    );
    expect(r.score.label).toBe("pass");
  });

  it("json_schema: invalid JSON → fail", async () => {
    const r = await run(
      { method: "json_schema", params: { schema: { type: "object" } } },
      { output: "not json" },
    );
    expect(r.score.label).toBe("fail");
  });

  it("json_schema: rejects params for a different method", async () => {
    await expect(
      run({ method: "json_schema", params: { pattern: ".*" } }, { output: "{}" }),
    ).rejects.toThrow(/schema/);
  });

  it("json_schema: rejects an invalid schema even when the output is invalid JSON", async () => {
    await expect(
      run(
        { method: "json_schema", params: { schema: { type: "not-a-type" } } },
        { output: "not json" },
      ),
    ).rejects.toThrow(/Invalid JSON Schema/);
  });

  it.each([
    ["exact_match", { caseSensitive: "false" }, /caseSensitive/],
    ["regex", { pattern: "x", flags: 1 }, /flags/],
    ["must_contain", { keywords: [1] }, /keywords/],
    ["json_schema", { schema: [] }, /schema/],
  ])("validates %s params at runtime", async (method, params, expectedError) => {
    await expect(
      run({ method, params } as Partial<PromptDefinition>, { output: "x", expectedOutput: "x" }),
    ).rejects.toThrow(expectedError as RegExp);
  });

  it("does not require a provider", async () => {
    await expect(
      run({ method: "regex", params: { pattern: "x" } }, { output: "x" }),
    ).resolves.toBeDefined();
  });
});
