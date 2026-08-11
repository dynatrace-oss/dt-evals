/**
 * Environment resolution and suite gating. A missing variable *skips* by
 * default, since contributors may run unit tests locally without tenant
 * credentials; `E2E_REQUIRE_ENV=1` inverts that so CI treats it as a red run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './paths.js';

/** The tenant host, under either accepted name — `DT_APPS_ENDPOINT` preferred, `DT_ENV_URL` (dt-evals' own) as fallback. */
const TENANT_HOST_VARS = ['DT_APPS_ENDPOINT', 'DT_ENV_URL'] as const;

let dotenvLoaded = false;

/** Load `test/e2e/.env` into `process.env` if present, without overwriting variables already set. */
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

/** Which variables the suite cannot run without are missing. Empty array means it can run. */
export function missingRequiredVars(): string[] {
  loadDotEnv();
  const missing: string[] = [];
  if (!tenantHost()) missing.push(TENANT_HOST_VARS.join(' or '));
  if (!process.env['DT_API_TOKEN']) missing.push('DT_API_TOKEN');
  return missing;
}

/** Whether an absent credential must fail the run rather than skip it. Explicitly off for `0`/`false`/`no`. */
export function requireEnv(): boolean {
  const value = envOr('E2E_REQUIRE_ENV', '').toLowerCase();
  return value !== '' && value !== '0' && value !== 'false' && value !== 'no';
}

/** Names already warned about. Stored on `process.env`, not a module `Set`, since vitest gives each suite file a fresh module registry. */
const WARNED_VAR = '__DT_EVALS_E2E_CREDENTIALS_WARNED__';

function alreadyWarned(what: string): boolean {
  const seen = new Set((process.env[WARNED_VAR] ?? '').split(',').filter(Boolean));
  if (seen.has(what)) return true;
  seen.add(what);
  process.env[WARNED_VAR] = [...seen].join(',');
  return false;
}

/** Report a missing credential set. Skips by default, throws under {@link requireEnv} — one place decides skip-vs-fail. */
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

/** Whether the tenant-backed suites can run. Call at module scope in a `describe.skipIf(...)`. */
export function e2eEnabled(): boolean {
  const missing = missingRequiredVars();
  if (missing.length === 0) return true;
  reportMissingCredentials('tenant access', missing);
  return false;
}

/** Per-request HTTP timeout, exceeding the server-side 25s with headroom. Override with `E2E_DT_HTTP_TIMEOUT`. */
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
