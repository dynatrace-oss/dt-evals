import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DtctlContext {
  name: string;
  environmentUrl?: string;
  isCurrent?: boolean;
}

export interface PermissionCheck {
  scope: string;
  label: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
}

export interface PlatformToken {
  id: string;
  token: string;
}

// ─── Binary detection ─────────────────────────────────────────────────────────

export async function isDtctlInstalled(): Promise<boolean> {
  try {
    await execFileAsync('dtctl', ['version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function getDtctlVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('dtctl', ['version'], { timeout: 5_000 });
    // First line of `dtctl version` output: "dtctl version 0.24.0"
    return stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Context management ───────────────────────────────────────────────────────

/**
 * List dtctl contexts.
 * dtctl v0.24.0: `dtctl ctx` (no flags needed — non-TTY automatically uses JSON agent mode).
 */
export async function listContexts(): Promise<DtctlContext[]> {
  try {
    // dtctl ctx in non-TTY outputs {"ok":true,"result":[...]} automatically
    const { stdout } = await execFileAsync('dtctl', ['ctx', '-o', 'json'], { timeout: 10_000 });
    return parseContextOutput(stdout);
  } catch {
    try {
      // fallback: no -o flag (relies on agent-mode auto-detection in non-TTY)
      const { stdout } = await execFileAsync('dtctl', ['ctx'], { timeout: 10_000 });
      return parseContextOutput(stdout);
    } catch {
      return [];
    }
  }
}

function parseContextOutput(raw: string): DtctlContext[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    // dtctl agent-mode envelope: {"ok": true, "result": [...]}
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : (parsed as Record<string, unknown>)?.['result'] != null
      ? ((parsed as Record<string, unknown>)['result'] as unknown[])
      : [];
    return arr.map(c => {
      const obj = c as Record<string, unknown>;
      return {
        name: String(obj['Name'] ?? obj['name'] ?? 'unknown'),
        environmentUrl: obj['Environment'] != null ? String(obj['Environment']) :
          obj['environmentUrl'] != null ? String(obj['environmentUrl']) : undefined,
        isCurrent: obj['Current'] === '*' || Boolean(obj['isCurrent']),
      };
    });
  } catch {
    // plain text — each line is a context name
    return trimmed.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('NAME') && !l.startsWith('---'))
      .map(l => ({ name: l.split(/\s+/)[0] ?? l }));
  }
}

export async function getCurrentContext(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('dtctl', ['ctx', 'current'], { timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// ─── Bearer token extraction ──────────────────────────────────────────────────

/**
 * Extract the OAuth Bearer token for a context by running dtctl in full-debug (-vv)
 * mode and parsing the Authorization header it sends.
 */
export async function getBearerToken(contextName: string): Promise<string> {
  const args = ['-vv', 'auth', 'whoami', '--plain'];
  if (contextName) args.push('--context', contextName);
  const { stdout, stderr } = await execFileAsync('dtctl', args, { timeout: 15_000 });
  const combined = stdout + '\n' + stderr;
  // -vv outputs full HTTP headers including: "Authorization: Bearer <token>"
  const match = combined.match(/Authorization:\s*Bearer\s+(\S+)/i);
  if (match?.[1]) return match[1];
  throw new Error(
    'Could not extract bearer token from dtctl. ' +
    'The context may be unauthenticated — run: dtctl auth login --context ' + contextName
  );
}

// ─── Browser OAuth flow ───────────────────────────────────────────────────────

/**
 * Authenticate a dtctl context via browser OAuth.
 * Uses `dtctl auth login --context <name> --environment <url>`.
 * Calls onTick every ~2s with elapsed seconds while waiting.
 * Resolves with the bearer token once auth completes.
 */
export async function authenticateWithBrowser(
  contextName: string,
  environmentUrl: string,
  onTick: (elapsedSeconds: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const args = [
    'auth', 'login',
    '--context', contextName,
    '--environment', environmentUrl,
    '--timeout', '5m',
  ];

  return new Promise<string>((resolve, reject) => {
    const proc = spawn('dtctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const startTime = Date.now();
    let settled = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };

    signal?.addEventListener('abort', () => {
      proc.kill('SIGTERM');
      settle(() => reject(new Error('Authentication cancelled')));
    });

    // Tick timer so the caller can update a spinner
    const ticker = setInterval(() => {
      onTick(Math.floor((Date.now() - startTime) / 1000));
    }, 2_000);

    proc.on('exit', async (code) => {
      clearInterval(ticker);
      if (code !== 0) {
        settle(() => reject(new Error(`dtctl auth login exited with code ${code}`)));
        return;
      }
      // Login succeeded — now extract the bearer token
      try {
        const token = await getBearerToken(contextName);
        settle(() => resolve(token));
      } catch (err) {
        settle(() => reject(err));
      }
    });

    proc.on('error', (err) => {
      clearInterval(ticker);
      settle(() => reject(err));
    });
  });
}

// ─── Permission probes ────────────────────────────────────────────────────────
//
// Probes accept either:
//   - a Dynatrace classic API token (`dt0c01....` / `dt0c0...`), or
//   - an OAuth/Platform token (`dt0s....`) pasted by the user from
//     https://myaccount.dynatrace.com/platformTokens
//     See also: https://docs.dynatrace.com/docs/shortlink/platform-tokens#how-to-use-a-platform-token
//
// `authScheme` picks the right HTTP scheme so callers don't have to care.

function authScheme(token: string): string {
  return token.startsWith('dt0c') ? `Api-Token ${token}` : `Bearer ${token}`;
}

async function probeDql(
  environmentUrl: string,
  bearerToken: string,
  query: string,
  scope: string,
  label: string,
): Promise<PermissionCheck> {
  const url = `${environmentUrl.replace(/\/$/, '')}/platform/storage/query/v1/query:execute`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authScheme(bearerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, requestTimeoutMilliseconds: 5000 }),
      signal: AbortSignal.timeout(12_000),
    });
    return { scope, label, ok: response.status !== 401 && response.status !== 403, statusCode: response.status };
  } catch (err) {
    return { scope, label, ok: false, error: (err as Error).message };
  }
}

/** storage:spans:read — required for fetching GenAI spans (fetch spans DQL) */
export async function checkSpansPermission(environmentUrl: string, bearerToken: string): Promise<PermissionCheck> {
  return probeDql(environmentUrl, bearerToken,
    'fetch spans | limit 1',
    'storage:spans:read',
    'Span read (storage:spans:read)',
  );
}

/** storage:events:read — required for drift detection baseline (fetch bizevents DQL) */
export async function checkEventsReadPermission(environmentUrl: string, bearerToken: string): Promise<PermissionCheck> {
  return probeDql(environmentUrl, bearerToken,
    'fetch bizevents | limit 1',
    'storage:bizevents:read',
    'Bizevent read (storage:bizevents:read)',
  );
}

/**
 * Also run the DQL check via dtctl subprocess (more reliable since dtctl manages token refresh).
 * Returns span count or null.
 */
export async function countGenAiSpansViaDtctl(
  contextName: string,
  service?: string,
): Promise<number | null> {
  const serviceFilter = service
    ? `| filter service.name == "${service}" or dt.smartscape.service == "${service}"\n`
    : '';
  const query = `fetch spans\n${serviceFilter}| filter isNotNull(gen_ai.provider.name)\n| filter timestamp >= now() - duration("24h")\n| summarize count = count()`;
  try {
    const { stdout } = await execFileAsync(
      'dtctl',
      ['query', query, '--context', contextName, '-o', 'json', '--plain'],
      { timeout: 30_000 },
    );
    const parsed = JSON.parse(stdout.trim()) as { records?: Array<Record<string, unknown>> };
    const records = parsed.records ?? [];
    const count = records[0]?.['count'];
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
}

export async function countGenAiSpans(
  environmentUrl: string,
  bearerToken: string,
  service?: string,
): Promise<number | null> {
  const url = `${environmentUrl.replace(/\/$/, '')}/platform/storage/query/v1/query:execute`;
  const serviceFilter = service
    ? `| filter service.name == "${service}" or dt.smartscape.service == "${service}"\n`
    : '';
  const query = `fetch spans, from: now()-24h\n${serviceFilter}| filter isNotNull(gen_ai.provider.name)\n| summarize count = count()`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authScheme(bearerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, requestTimeoutMilliseconds: 15000 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { result?: { records?: Array<Record<string, unknown>> } };
    
    const records = data.result?.records ?? [];
    const count = records[0]?.['count'];
    if (typeof count === 'number') return count;
    if (typeof count === 'string') {
      const parsed = parseInt(count, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Translate `*.apps.dynatrace.com` → `*.live.dynatrace.com` for ingest probes;
 *  also handles `dynatracelabs.com` lab environments. Idempotent on other hosts. */
export function liveSubdomain(url: string): string {
  return url
    .replace(/^(https?:\/\/[^/]+?)\.apps\.dynatrace\.com/, '$1.live.dynatrace.com')
    .replace(/^(https?:\/\/[^/]+?)\.apps\.dynatracelabs\.com/, '$1.dynatracelabs.com');
}

export async function checkBizeventPermission(environmentUrl: string, bearerToken: string): Promise<PermissionCheck> {
  const isClassic = /\.apps\.dynatrace\.com(\/|$)/i.test(environmentUrl);
  const scope = isClassic ? 'storage:events:write' : 'openpipeline:bizevents:ingest';
  const label = isClassic
    ? 'Bizevent write (storage:events:write)'
    : 'Bizevent write (openpipeline:bizevents:ingest)';

  // Probe the same URL the runtime client posts to.
  const url = `${liveSubdomain(environmentUrl.replace(/\/$/, ''))}/api/v2/bizevents/ingest`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authScheme(bearerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ 'event.provider': 'dt-evals.doctor.probe', 'event.type': 'connectivity.check' }]),
      signal: AbortSignal.timeout(10_000),
    });
    return { scope, label, ok: response.status !== 401 && response.status !== 403, statusCode: response.status };
  } catch (err) {
    return { scope, label, ok: false, error: (err as Error).message };
  }
}

export async function checkMetricsPermission(environmentUrl: string, bearerToken: string): Promise<PermissionCheck> {
  const url = `${liveSubdomain(environmentUrl.replace(/\/$/, ''))}/api/v2/metrics/ingest`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authScheme(bearerToken), 'Content-Type': 'text/plain' },
      body: 'dt.evals.doctor.probe,probe=true 1',
      signal: AbortSignal.timeout(10_000),
    });
    return {
      scope: 'storage:metrics:write',
      label: 'Metrics ingest (storage:metrics:write)',
      ok: response.status !== 401 && response.status !== 403,
      statusCode: response.status,
    };
  } catch (err) {
    return { scope: 'storage:metrics:write', label: 'Metrics ingest (storage:metrics:write)', ok: false, error: (err as Error).message };
  }
}

export async function createPlatformToken(
  environmentUrl: string,
  bearerToken: string,
  name: string,
  scopes: string[],
): Promise<PlatformToken> {
  const url = `${environmentUrl.replace(/\/$/, '')}/api/v2/apiTokens`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authScheme(bearerToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scopes }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token creation failed (${response.status}): ${text}`);
  }
  const data = await response.json() as { id: string; token: string };
  return { id: data.id, token: data.token };
}
