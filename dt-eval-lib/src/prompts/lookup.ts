import { EvalMetricError } from "../errors";
import { catalog } from "./catalog-data";
import { readCustomPrompts } from "./custom";
import type { PromptDefinition } from "./types";

function allPrompts(): PromptDefinition[] {
  return [...catalog, ...readCustomPrompts()];
}

export function getPrompt(id: string): PromptDefinition {
  const prompt = allPrompts().find((p) => p.id === id);
  if (!prompt) {
    throw new EvalMetricError(
      `Unknown metric "${id}". Available: ${allPrompts()
        .map((p) => p.id)
        .join(", ")}`,
    );
  }
  return prompt;
}

export function listPrompts(): PromptDefinition[] {
  return allPrompts();
}
