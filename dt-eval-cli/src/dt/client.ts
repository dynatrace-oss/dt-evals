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

export class DynatraceClient {
  private readonly environmentUrl: string;
  private readonly apiToken: string;

  constructor(config: DynatraceClientConfig) {
    this.environmentUrl = config.environmentUrl.replace(/\/$/, '');
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
      throw new Error(`DQL execute failed (${response.status}): ${text}`);
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

  async ingestBizevents(events: object[]): Promise<void> {
    const url = `${this.environmentUrl}/platform/ingest/v1/bizevents`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(events),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bizevent ingest failed (${response.status}): ${text}`);
    }
  }

  async ingestMetrics(lines: string): Promise<void> {
    const url = `${this.environmentUrl}/api/v2/metrics/ingest`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'text/plain' },
      body: lines,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Metrics ingest failed (${response.status}): ${text}`);
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
