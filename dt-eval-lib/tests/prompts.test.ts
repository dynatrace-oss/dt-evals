import { describe, expect, it } from "vitest";
import { EvalMetricError } from "../src/errors";
import { BuiltInMetric, getPrompt, listPrompts } from "../src/prompts/index";

describe("prompt catalog", () => {
  it("loads all 14 built-in prompts", () => {
    const prompts = listPrompts();
    expect(prompts).toHaveLength(14);
  });

  it("each prompt has id, name, version, description, prompt, requiredFields, scoring", () => {
    const prompts = listPrompts();
    for (const p of prompts) {
      expect(p).toHaveProperty("id");
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("version");
      expect(p).toHaveProperty("description");
      expect(p).toHaveProperty("prompt");
      expect(p).toHaveProperty("requiredFields");
      expect(p).toHaveProperty("scoring");
    }
  });

  it("each prompt has embedded scoring with type, range, and threshold", () => {
    const prompts = listPrompts();
    for (const p of prompts) {
      expect(p.scoring).toHaveProperty("type");
      expect(p.scoring).toHaveProperty("range");
      expect(p.scoring).toHaveProperty("threshold");
      expect(["binary", "continuous", "likert"]).toContain(p.scoring.type);
      expect(p.scoring.range).toHaveLength(2);
    }
  });

  it("each prompt contains placeholder tokens matching its requiredFields", () => {
    const prompts = listPrompts();
    for (const p of prompts) {
      for (const field of p.requiredFields) {
        expect(p.prompt).toContain(`{{${field}}}`);
      }
    }
  });

  const scoringCases = [
    { id: BuiltInMetric.Fluency, type: "continuous", threshold: 0.7 },
    { id: BuiltInMetric.Toxicity, type: "continuous", threshold: 0.9 },
    { id: BuiltInMetric.Faithfulness, type: "continuous", threshold: 0.8 },
    { id: BuiltInMetric.Hallucination, type: "continuous", threshold: 0.8 },
    { id: BuiltInMetric.PiiLeakage, type: "continuous", threshold: 0.9 },
    { id: BuiltInMetric.FactualAccuracy, type: "continuous", threshold: 0.8 },
    { id: BuiltInMetric.UserFrustration, type: "binary", threshold: 1 },
  ] as const;

  it.each(scoringCases)("$id has $type scoring with threshold $threshold", ({
    id,
    type,
    threshold,
  }) => {
    const p = getPrompt(id);
    expect(p.scoring.type).toBe(type);
    expect(p.scoring.threshold).toBe(threshold);
  });

  const requiredFieldsCases = [
    { id: BuiltInMetric.Fluency, fields: ["input", "output", "context"] },
    { id: BuiltInMetric.Toxicity, fields: ["input", "output"] },
    { id: BuiltInMetric.Faithfulness, fields: ["input", "output", "context"] },
    { id: BuiltInMetric.Hallucination, fields: ["input", "output", "context"] },
    { id: BuiltInMetric.PiiLeakage, fields: ["input", "output"] },
    { id: BuiltInMetric.Relevance, fields: ["input", "output"] },
    { id: BuiltInMetric.FactualAccuracy, fields: ["input", "output", "expectedOutput"] },
    { id: BuiltInMetric.UserFrustration, fields: ["input"] },
    { id: BuiltInMetric.ContextRelevance, fields: ["input", "context"] },
    { id: BuiltInMetric.AnswerCompleteness, fields: ["input", "output"] },
    { id: BuiltInMetric.PromptInjection, fields: ["input", "output"] },
    { id: BuiltInMetric.Bias, fields: ["input", "output"] },
    { id: BuiltInMetric.SummarizationQuality, fields: ["input", "output"] },
    { id: BuiltInMetric.Conciseness, fields: ["input", "output"] },
  ] as const;

  it.each(requiredFieldsCases)("$id requires $fields", ({ id, fields }) => {
    const p = getPrompt(id);
    expect(p.requiredFields).toEqual(fields);
  });
});

describe("getPrompt", () => {
  it("returns prompt by id", () => {
    const p = getPrompt(BuiltInMetric.Toxicity);
    expect(p.id).toBe("toxicity");
    expect(p.name).toBe("Toxicity");
  });

  it("throws EvalMetricError for unknown id", () => {
    expect(() => getPrompt("nonexistent")).toThrow(EvalMetricError);
  });

  it("error message lists available metrics", () => {
    try {
      getPrompt("nonexistent");
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("toxicity");
      expect((e as Error).message).toContain("faithfulness");
    }
  });
});

describe("listPrompts", () => {
  it("returns all 14 prompts", () => {
    const prompts = listPrompts();
    expect(prompts).toHaveLength(14);
  });

  it("getPrompt and listPrompts are synchronous", () => {
    const prompt = getPrompt(BuiltInMetric.Toxicity);
    expect(prompt).not.toBeInstanceOf(Promise);
    const prompts = listPrompts();
    expect(prompts).not.toBeInstanceOf(Promise);
  });
});

describe("BuiltInMetric enum", () => {
  it("has all 14 metric IDs", () => {
    expect(Object.values(BuiltInMetric)).toHaveLength(14);
  });

  it("enum values match catalog IDs", () => {
    const prompts = listPrompts();
    const catalogIds = prompts.map((p) => p.id).sort();
    const enumValues = Object.values(BuiltInMetric).sort();
    expect(enumValues).toEqual(catalogIds);
  });
});
