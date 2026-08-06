/**
 * Repository-relative path resolution.
 *
 * Ported from `repoRoot()` in `fixture_apps_test.go`, which derives the root
 * from the source file's own location rather than from the working directory —
 * so helpers keep working regardless of where the runner was invoked from.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the dt-evals repository root (this file lives at test/e2e/src/). */
export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * Absolute path to the built CLI entry point — the artifact a user actually runs
 * (`package.json#bin` maps `dt-evals` to `dist/index.js`). The suite drives this
 * rather than `src/index.ts` via tsx, because the design doc treats the CLI as a
 * black box and the built bundle is what ships.
 */
export function cliEntryPoint(): string {
  return join(repoRoot(), 'dt-eval-cli', 'dist', 'index.js');
}

/**
 * Throw a message that says how to fix it when the CLI has not been built.
 * Same intent as the `tsx`-exists guard in
 * `dt-eval-cli/tests/configure.integration.test.ts:35`: fail on the missing
 * prerequisite, not on a confusing downstream spawn error.
 */
export function assertCliBuilt(): void {
  const entry = cliEntryPoint();
  if (!existsSync(entry)) {
    throw new Error(
      `built CLI not found at ${entry} — run "npm ci && npm run build" in dt-eval-cli first`,
    );
  }
}
