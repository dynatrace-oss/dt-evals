import { EvalMetricError } from "../errors";
import { getPromptStore } from "./store";
import type { PromptDefinition } from "./types";

export function readCustomPrompts(): PromptDefinition[] {
  return getPromptStore()?.read() ?? [];
}

export function createCustomPrompt(prompt: PromptDefinition): void {
  const store = getPromptStore();
  if (!store) {
    throw new EvalMetricError(
      "No prompt store registered. Custom prompts require a storage backend.",
    );
  }
  const existing = store.read();
  const idx = existing.findIndex((p) => p.id === prompt.id);
  if (idx >= 0) {
    existing[idx] = prompt;
  } else {
    existing.push(prompt);
  }
  store.write(existing);
}

export function deleteCustomPrompt(id: string): void {
  const store = getPromptStore();
  if (!store) {
    throw new EvalMetricError(
      "No prompt store registered. Custom prompts require a storage backend.",
    );
  }
  const existing = store.read();
  const updated = existing.filter((p) => p.id !== id);
  if (updated.length === existing.length) {
    throw new EvalMetricError(`Custom evaluator "${id}" not found`);
  }
  store.write(updated);
}
