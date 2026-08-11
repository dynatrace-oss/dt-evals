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
  if (!process.env['E2E_DT_OAUTH_CLIENT_ID']) missing.push('E2E_DT_OAUTH_CLIENT_ID');
  if (!process.env['E2E_DT_OAUTH_SECRET']) missing.push('E2E_DT_OAUTH_SECRET');
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

/** SSO token endpoint for the client-credentials grant. Overridable for a non-production SSO; defaults to the real one. */
function oauthTokenUrl(): string {
  return envOr('E2E_DT_OAUTH_URL', 'https://sso.dynatrace.com/sso/oauth2/token');
}

/** Everything the suite's own DQL reads need, plus what `run --ci` writes for the CLI under test. */
const OAUTH_SCOPES = [
  'storage:spans:read',
  'storage:buckets:read',
  'storage:events:read',
  'storage:bizevents:read',
  'storage:events:write',
  'storage:metrics:write',
  'storage:logs:read',
  'storage:bucket-definitions:read',
  'storage:entities:read',
  'storage:metrics:read',
].join(' ');

interface OauthTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Refetch this long before the token's real expiry, so a call mid-suite doesn't race an in-flight expiry. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Assumed lifetime when the response omits `expires_in` — conservative, so a missing field fails safe toward refetching. */
const DEFAULT_TOKEN_TTL_MS = 300_000;

let cachedToken: CachedToken | undefined;
let pendingFetch: Promise<CachedToken> | undefined;

/**
 * Client-credentials grant against Dynatrace SSO — replaces a pasted platform
 * token (`DT_API_TOKEN`). Cached until shortly before it expires, then
 * refetched on demand — not just once per suite run, since some suites now
 * run long enough (`fixtures.ts`'s `runCiTimeoutMs`) to outlast a short-lived
 * token. `authScheme` in dynatrace.ts already sends non-`dt0c*` tokens as
 * `Bearer`, so the fetched token needs no special-casing on the read side;
 * `tenantCliEnv` (cli.ts) hands the same token to the CLI under test as
 * `DT_API_TOKEN`.
 */
async function oauthAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (!pendingFetch) {
    pendingFetch = fetchOauthAccessToken().finally(() => {
      pendingFetch = undefined;
    });
  }
  cachedToken = await pendingFetch;
  return cachedToken.token;
}

async function fetchOauthAccessToken(): Promise<CachedToken> {
  const url = oauthTokenUrl();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: mustEnv('E2E_DT_OAUTH_CLIENT_ID'),
    client_secret: mustEnv('E2E_DT_OAUTH_SECRET'),
    scope: OAUTH_SCOPES,
  });

  // Same fail-fast philosophy as dynatrace.ts's fetchWithTimeout: a hung SSO host
  // should surface as a named OAuth failure, not an opaque "Test timed out".
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dtHttpTimeoutMs());
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    const cause = (err as { cause?: Error }).cause;
    throw new Error(
      `OAuth token request to ${new URL(url).host} failed: ${cause?.message ?? (err as Error).message}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => ({}))) as OauthTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(
      `OAuth token request to ${new URL(url).host} failed (${response.status}): ` +
        `${payload.error ?? response.statusText}` +
        `${payload.error_description ? ` — ${payload.error_description}` : ''}`,
    );
  }

  const ttlMs = payload.expires_in ? payload.expires_in * 1000 : DEFAULT_TOKEN_TTL_MS;
  return { token: payload.access_token, expiresAt: Date.now() + ttlMs - TOKEN_REFRESH_MARGIN_MS };
}

/** Tenant + token the suite reads spans from and hands to the CLI under test. */
export async function tenant(): Promise<{ appsEndpoint: string; apiToken: string }> {
  const host = tenantHost();
  if (!host) throw new Error(`required env var not set: ${TENANT_HOST_VARS.join(' or ')}`);
  return {
    appsEndpoint: host.replace(/\/+$/, ''),
    apiToken: await oauthAccessToken(),
  };
}
