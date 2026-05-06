import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PromptDefinition, PromptStore } from "@dynatrace-oss/dt-eval-lib";

const CUSTOM_PROMPTS_DIR = join(homedir(), ".config", "dt-eval");
const CUSTOM_PROMPTS_FILE = join(CUSTOM_PROMPTS_DIR, "custom-prompts.json");

export class FsPromptStore implements PromptStore {
  read(): PromptDefinition[] {
    try {
      if (!existsSync(CUSTOM_PROMPTS_FILE)) return [];
      const raw = readFileSync(CUSTOM_PROMPTS_FILE, "utf-8");
      return JSON.parse(raw) as PromptDefinition[];
    } catch {
      return [];
    }
  }

  write(prompts: PromptDefinition[]): void {
    if (!existsSync(CUSTOM_PROMPTS_DIR)) {
      mkdirSync(CUSTOM_PROMPTS_DIR, { recursive: true });
    }
    writeFileSync(
      CUSTOM_PROMPTS_FILE,
      JSON.stringify(prompts, null, 2),
      "utf-8",
    );
  }
}
