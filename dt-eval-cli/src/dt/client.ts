import { logger } from '../logger/index.js';

/**
 * Pick the right Authorization scheme for a Dynatrace token.
 * - `dt0s*` → platform token, requires `Bearer`
 * - `dt0c*` → classic API token, requires `Api-Token`
 * Defaults to `Bearer` (current platform direction).
 */
function authScheme(token: string): 'Bearer' | 'Api-Token' {
  if (token.startsWith('dt0c')) return 'Api-Token';
  return 'Bearer';
}

export interface DynatraceClientConfig {
  environmentUrl: string;
  apiToken?: string;
}

interface DqlNotification {
  severity?: string;
  notificationType?: string;
  message?: string;
}

interface DqlResultMetadata {
  grail?: {
    notifications?: DqlNotification[];
  };
}

interface DqlExecuteResponse {
  requestToken?: string;
  state?: string;
  result?: {
    records: unknown[];
    metadata?: DqlResultMetadata;
  };
}

interface DqlPollResponse {
  state: string;
  result?: {
    records: unknown[];
    metadata?: DqlResultMetadata;
  };
}

/**
 * Surface Grail notifications attached to a DQL response. Warnings such as
 * MISSING_BUCKET_PERMISSIONS arrive on a SUCCEEDED state with empty records,
 * so without this they would be silently swallowed.
 */
function logDqlNotifications(metadata: DqlResultMetadata | undefined): void {
  const notifications = metadata?.grail?.notifications;
  if (!notifications?.length) return;
  for (const n of notifications) {
    const tag = n.notificationType ? `[${n.notificationType}] ` : '';
    const message = n.message ?? n.notificationType ?? 'unknown';
    const severity = (n.severity ?? 'INFO').toUpperCase();
    const line = `DQL ${severity}: ${tag}${message}`;
    if (severity === 'WARNING' || severity === 'ERROR') {
      logger.warn(line);
    } else {
      logger.debug(line);
    }
  }
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Translate `*.apps.dynatrace.com` → `*.live.dynatrace.com`.
 *
 * Modern Dynatrace platform splits its surface across two subdomains:
 *   - `.apps.` hosts the platform-storage / DQL APIs (`/platform/storage/...`).
 *   - `.live.` hosts the classic environment APIs (`/api/v2/...`).
 *
 * Users supply a single `environmentUrl` for the tenant — by convention the
 * `.apps.` form (because DQL is the entry point). For ingest endpoints
 * (`/api/v2/bizevents/ingest`, `/api/v2/metrics/ingest`) we need to redirect
 * to `.live.`, otherwise the apps gateway returns 400 *Invalid app context*.
 *
 * Idempotent on URLs that already point at `.live.` or any other host
 * (cluster-managed, on-prem, dev sandboxes), so it's safe to call always.
 */
function liveSubdomain(url: string): string {
  return url.replace(/^(https?:\/\/[^/]+?)\.apps\.dynatrace\.com/, '$1.live.dynatrace.com');
}

export class DynatraceClient {
  private readonly environmentUrl: string;
  private readonly liveBaseUrl: string;
  private readonly apiToken: string;

  constructor(config: DynatraceClientConfig) {
    this.environmentUrl = config.environmentUrl.replace(/\/$/, '');
    this.liveBaseUrl = liveSubdomain(this.environmentUrl);
    this.apiToken = config.apiToken ?? '';
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `${authScheme(this.apiToken)} ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async executeDql(query: string): Promise<unknown> {
    const url = `${this.environmentUrl}/platform/storage/query/v1/query:execute`;
    const body = JSON.stringify({
      query,
      requestTimeoutMilliseconds: 30_000,
      fetchTimeoutSeconds: 30,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      const hint = response.status === 401 || response.status === 403
        ? ' — token needs storage:spans:read, storage:buckets:read, storage:events:read'
        : '';
      throw new Error(`DQL execute failed (${response.status})${hint}: ${text}`);
    }

    const data = (await response.json()) as DqlExecuteResponse;

    if (data.state === 'RUNNING' && data.requestToken) {
      return this.pollDqlResults(data.requestToken);
    }

    if (data.state === 'SUCCEEDED' || data.result) {
      logDqlNotifications(data.result?.metadata);
      return data.result?.records ?? [];
    }

    throw new Error(`Unexpected DQL response state: ${data.state}`);
  }

  /**
   * Probe whether the configured token can read a given storage table by
   * issuing `fetch <table> | limit 1` and inspecting the response for a
   * MISSING_BUCKET_PERMISSIONS notification (which Grail returns as a
   * SUCCEEDED-with-empty-records, not a 4xx). Used by `validate` to catch
   * scope problems on the origin tenant before a run is attempted.
   */
  async probeBucketRead(table: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const query = `fetch ${table} | limit 1`;
    const url = `${this.environmentUrl}/platform/storage/query/v1/query:execute`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ query, requestTimeoutMilliseconds: 10_000, fetchTimeoutSeconds: 10 }),
      });
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as DqlExecuteResponse;
    const notifications = data.result?.metadata?.grail?.notifications ?? [];
    const missing = notifications.find(n => n.notificationType === 'MISSING_BUCKET_PERMISSIONS');
    if (missing) {
      return { ok: false, reason: missing.message ?? 'MISSING_BUCKET_PERMISSIONS' };
    }
    return { ok: true };
  }

  async ingestBizevents(events: object[]): Promise<void> {
    // Classic env-api on `.live.` subdomain. See `liveSubdomain()` for why.
    const url = `${this.liveBaseUrl}/api/v2/bizevents/ingest`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(events),
    });

    if (!response.ok) {
      const text = await response.text();
      const hint = response.status === 401 || response.status === 403
        ? ' — token needs storage:events:write'
        : '';
      throw new Error(`Bizevent ingest failed (${response.status})${hint}: ${text}`);
    }
  }

  async ingestMetrics(lines: string): Promise<void> {
    // Classic env-api on `.live.` subdomain. See `liveSubdomain()` for why.
    const url = `${this.liveBaseUrl}/api/v2/metrics/ingest`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'text/plain' },
      body: lines,
    });

    if (!response.ok) {
      const text = await response.text();
      const hint = response.status === 401 || response.status === 403
        ? ' — token needs storage:metrics:write'
        : '';
      throw new Error(`Metrics ingest failed (${response.status})${hint}: ${text}`);
    }
  }

  private async pollDqlResults(requestToken: string): Promise<unknown> {
    const url = `${this.environmentUrl}/platform/storage/query/v1/query:poll?requestToken=${encodeURIComponent(requestToken)}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let pollCount = 0;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      pollCount++;

      const t0 = Date.now();
      const response = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`DQL poll failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as DqlPollResponse;
      logger.debug(`DQL poll #${pollCount} state=${data.state} ${Date.now() - t0}ms`);

      if (data.state === 'SUCCEEDED') {
        logDqlNotifications(data.result?.metadata);
        return data.result?.records ?? [];
      }

      if (data.state === 'FAILED') {
        throw new Error('DQL query execution failed on the server');
      }
    }

    throw new Error(`DQL poll timed out after ${POLL_TIMEOUT_MS}ms`);
  }
}
