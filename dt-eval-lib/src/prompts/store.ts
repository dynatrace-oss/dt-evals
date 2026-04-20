import type { PromptDefinition } from "./types";

export interface PromptStore {
  read(): PromptDefinition[];
  write(prompts: PromptDefinition[]): void;
}

let registeredStore: PromptStore | null = null;

export function registerPromptStore(store: PromptStore): void {
  registeredStore = store;
}

export function getPromptStore(): PromptStore | null {
  return registeredStore;
}
