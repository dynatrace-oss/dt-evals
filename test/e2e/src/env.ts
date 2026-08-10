/**
 * Environment resolution and suite gating.
 *
 * Ported from `fixture_suite_test.go` in the instrumentation-examples Go suite,
 * with one deliberate difference: that suite panics on a missing variable, which
 * is right for a repo where E2E is the only thing the module does. Here the
 * suite lives alongside unit tests a contributor may run locally without tenant
 * credentials, so a missing variable *skips* by default.
 *
 * Skipping is also how E2E suites rot: a suite that skips every case still
 * reports green. `E2E_REQUIRE_ENV=1` inverts the behaviour so CI treats a
 * missing secret as a red run. CI must always set it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './paths.js';

/**
 * The tenant host, under either accepted name.
 *
 * `DT_APPS_ENDPOINT` is the instrumentation-examples convention (the
 * platform/apps host that serves the DQL API) and is preferred, because that is
 * the repo whose CI seeds the fixtures this suite reads.
 *
 * `DT_ENV_URL` is accepted as a fallback because it is the name dt-evals itself
 * reads (`dt-eval-cli/src/config/index.ts:84`) and the name this repo's existing
 * tenant workflow already uses as a secret
 * (`.github/workflows/evals-pydantic-ai-music-agent.yml`). Both name the same
 * host, so requiring the other one would mean maintaining a duplicate secret.
 */
const TENANT_HOST_VARS = ['DT_APPS_ENDPOINT', 'DT_ENV_URL'] as const;

let dotenvLoaded = false;

/**
 * Load `test/e2e/.env` into `process.env` if present, without overwriting
 * variables that are already set. Mirrors what the CLI does at
 * `dt-eval-cli/src/index.ts:12` so a developer's local workflow matches CI's,
 * where the same values arrive as real environment variables and must win.
 */
export function loadDotEnv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  const file = join(repoRoot(), 'test', 'e2e', '.env');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

/** Return the variable's value, or throw naming it — for values a test cannot proceed without. */
export function mustEnv(key: string): string {
  loadDotEnv();
  const value = process.env[key];
  if (!value) throw new Error(`required env var not set: ${key}`);
  return value;
}

/** Return the variable's value, or `fallback` when unset or empty. */
export function envOr(key: string, fallback: string): string {
  loadDotEnv();
  const value = process.env[key];
  return value && value.length > 0 ? value : fallback;
}

/** Return the variable's value, or `undefined` when unset or empty. */
export function envOrUndefined(key: string): string | undefined {
  loadDotEnv();
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

/** The tenant host from whichever accepted variable is set. */
function tenantHost(): string | undefined {
  loadDotEnv();
  for (const key of TENANT_HOST_VARS) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

/**
 * Which variables the suite cannot run without are missing. Empty array means
 * it can run.
 *
 * The list is computed here rather than declared as a constant alongside it:
 * two spellings of "what is required" drift apart, and the one nobody reads
 * wins the argument at the worst moment.
 */
export function missingRequiredVars(): string[] {
  loadDotEnv();
  const missing: string[] = [];
  if (!tenantHost()) missing.push(TENANT_HOST_VARS.join(' or '));
  if (!process.env['DT_API_TOKEN']) missing.push('DT_API_TOKEN');
  return missing;
}

/**
 * Whether an absent credential must fail the run rather than skip it.
 *
 * CI sets `E2E_REQUIRE_ENV=1`. Explicitly off for `0`/`false`/`no` — treating
 * those as "on" merely because the variable is non-empty is the kind of sharp
 * edge that gets a pipeline stuck for an afternoon.
 */
export function requireEnv(): boolean {
  const value = envOr('E2E_REQUIRE_ENV', '').toLowerCase();
  return value !== '' && value !== '0' && value !== 'false' && value !== 'no';
}

/**
 * Names already warned about by {@link reportMissingCredentials} in this run.
 *
 * Stored on `process.env` rather than a module-level `Set`: vitest gives each
 * suite file its own fresh module registry even within one forked process
 * (`e2eEnabled()`/`judgeFromEnv()` are called at module scope in five separate
 * files), so a `let` here would reset per file and warn every time regardless.
 * `process.env` is the one thing that actually survives that reset, because it
 * mirrors the OS process's real environment table rather than JS module state.
 * The variable is internal bookkeeping, not a credential, and never reaches the
 * CLI subprocess — the child's env is built explicitly from scratch, not copied
 * from this process's.
 */
const WARNED_VAR = '__DT_EVALS_E2E_CREDENTIALS_WARNED__';

function alreadyWarned(what: string): boolean {
  const seen = new Set((process.env[WARNED_VAR] ?? '').split(',').filter(Boolean));
  if (seen.has(what)) return true;
  seen.add(what);
  process.env[WARNED_VAR] = [...seen].join(',');
  return false;
}

/**
 * Report a credential set the suite needs but does not have.
 *
 * Skips by default, throws under {@link requireEnv}. Every gate goes through
 * here so the skip-vs-fail decision is made in exactly one place: the first
 * version of this file applied it to the tenant variables only, which let a CI
 * run with `E2E_REQUIRE_ENV=1` but no judge credentials skip the `validate` and
 * `run` suites — 14 of 28 tests — and still report green.
 */
export function reportMissingCredentials(what: string, missing: string[]): void {
  const detail =
    `dt-evals E2E: ${what} not configured (missing ${missing.join(', ')}) — see test/e2e/README.md`;
  if (requireEnv()) {
    throw new Error(
      `${detail}. E2E_REQUIRE_ENV is set, so this is a failure rather than a skip.`,
    );
  }
  if (alreadyWarned(what)) return;
  console.warn(`${detail}. Skipping the suites that need it.`);
}

/**
 * Whether the tenant-backed suites can run.
 *
 * Call this at module scope in a `describe.skipIf(...)`. When credentials are
 * missing it logs which ones — a skip with no explanation is indistinguishable
 * from a suite that silently stopped testing anything.
 */
export function e2eEnabled(): boolean {
  const missing = missingRequiredVars();
  if (missing.length === 0) return true;
  reportMissingCredentials('tenant access', missing);
  return false;
}

/**
 * The deliberately under-scoped tenant token, or `undefined` when unavailable.
 *
 * This is the one credential the suite treats as optional, because it cannot be
 * derived from the main one: provoking the spans-bucket probe needs a token that
 * connects successfully but lacks `storage:spans:read`, and a wholly invalid
 * token fails the connection probe first.
 *
 * That optionality has a cost the rest of the suite does not pay. Every other
 * gate routes through {@link reportMissingCredentials}, so `E2E_REQUIRE_ENV=1`
 * turns a missing credential red. This one cannot — under require-mode it would
 * fail every CI run until someone mints the second token — so the case would
 * otherwise skip forever, in CI, with nothing that ever goes red to say so. And
 * it covers the probe most worth having a negative case for: Grail answers a
 * missing-scope query with SUCCEEDED-and-zero-records rather than a 403, so a
 * regression here turns a misscoped token into "the tenant looks empty".
 *
 * `E2E_REQUIRE_MISSCOPED_TOKEN` is the escape from that trap: set it once the
 * secret is actually provisioned, and a later disappearance becomes a failure
 * instead of a silent skip. Off by default, so nothing breaks before then.
 */
export function misscopedToken(): string | undefined {
  const value = envOrUndefined('E2E_DT_MISSCOPED_TOKEN');
  if (value) return value;

  if (envOrUndefined('E2E_REQUIRE_MISSCOPED_TOKEN')) {
    throw new Error(
      'dt-evals E2E: E2E_REQUIRE_MISSCOPED_TOKEN is set, but E2E_DT_MISSCOPED_TOKEN is not. ' +
        'The spans-bucket negative case cannot run. Either provision the second token ' +
        '(scopes: storage:logs:read, and deliberately NOT storage:spans:read) or unset ' +
        'E2E_REQUIRE_MISSCOPED_TOKEN — see test/e2e/README.md.',
    );
  }
  return undefined;
}

/**
 * Per-request HTTP timeout for Dynatrace platform API calls. Must exceed the
 * server-side `requestTimeoutMilliseconds` (25s) with headroom for gateway
 * latency. Override with `E2E_DT_HTTP_TIMEOUT` in milliseconds.
 */
export function dtHttpTimeoutMs(): number {
  const parsed = Number(envOr('E2E_DT_HTTP_TIMEOUT', '60000'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

/** Tenant + token the suite reads spans from. */
export function tenant(): { appsEndpoint: string; apiToken: string } {
  const host = tenantHost();
  if (!host) throw new Error(`required env var not set: ${TENANT_HOST_VARS.join(' or ')}`);
  return {
    appsEndpoint: host.replace(/\/+$/, ''),
    apiToken: mustEnv('DT_API_TOKEN'),
  };
}
