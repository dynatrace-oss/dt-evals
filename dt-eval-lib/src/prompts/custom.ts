/**
 * Custom prompt persistence — stores user-defined evaluators in
 * ~/.config/dt-eval/custom-prompts.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EvalMetricError } from "../errors";
import type { PromptDefinition } from "./types";

const CUSTOM_PROMPTS_DIR = join(homedir(), ".config", "dt-eval");
const CUSTOM_PROMPTS_FILE = join(CUSTOM_PROMPTS_DIR, "custom-prompts.json");

export function readCustomPrompts(): PromptDefinition[] {
  try {
    if (!existsSync(CUSTOM_PROMPTS_FILE)) return [];
    const raw = readFileSync(CUSTOM_PROMPTS_FILE, "utf-8");
    return JSON.parse(raw) as PromptDefinition[];
  } catch {
    return [];
  }
}

function writeCustomPrompts(prompts: PromptDefinition[]): void {
  if (!existsSync(CUSTOM_PROMPTS_DIR)) {
    mkdirSync(CUSTOM_PROMPTS_DIR, { recursive: true });
  }
  writeFileSync(CUSTOM_PROMPTS_FILE, JSON.stringify(prompts, null, 2), "utf-8");
}

export function createCustomPrompt(prompt: PromptDefinition): void {
  const existing = readCustomPrompts();
  const idx = existing.findIndex((p) => p.id === prompt.id);
  if (idx >= 0) {
    existing[idx] = prompt;
  } else {
    existing.push(prompt);
  }
  writeCustomPrompts(existing);
}

export function deleteCustomPrompt(id: string): void {
  const existing = readCustomPrompts();
  const updated = existing.filter((p) => p.id !== id);
  if (updated.length === existing.length) {
    throw new EvalMetricError(`Custom evaluator "${id}" not found`);
  }
  writeCustomPrompts(updated);
}
