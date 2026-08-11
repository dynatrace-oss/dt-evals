/** Repository-relative path resolution, derived from this file's own location rather than the cwd. */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the dt-evals repository root (this file lives at test/e2e/src/). */
export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** Absolute path to the built CLI entry point — the suite drives the shipped bundle, not `src/index.ts`. */
export function cliEntryPoint(): string {
  return join(repoRoot(), 'dt-eval-cli', 'dist', 'index.js');
}

/** Fail on a missing build with a fix-it message, not a confusing downstream spawn error. */
export function assertCliBuilt(): void {
  const entry = cliEntryPoint();
  if (!existsSync(entry)) {
    throw new Error(
      `built CLI not found at ${entry} — run "npm ci && npm run build" in dt-eval-cli first`,
    );
  }
}
