import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger/index.js';

const execFileAsync = promisify(execFile);

export interface DynatraceClientConfig {
  environmentUrl: string;
  apiToken?: string;
  /** dtctl context name — when set, Bearer auth is obtained from dtctl for all requests. */
  dtctlContext?: string;
}

interface DqlExecuteResponse {
  requestToken?: string;
  state?: string;
  result?: {
    records: unknown[];
  };
}

interface DqlPollResponse {
  state: string;
  result?: {
    records: unknown[];
  };
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;
// Cache the Bearer token for 5 min to avoid a dtctl subprocess on every call
const TOKEN_TTL_MS = 5 * 60 * 1000;

export class DynatraceClient {
  private readonly environmentUrl: string;
  private readonly apiToken?: string;
  private readonly dtctlContext?: string;

  private cachedToken?: string;
  private tokenExpiresAt = 0;

  constructor(config: DynatraceClientConfig) {
    this.environmentUrl = config.environmentUrl.replace(/\/$/, '');
    this.apiToken = config.apiToken;
    this.dtctlContext = config.dtctlContext;
  }

  /** Resolve auth headers — Bearer via dtctl when available, Api-Token otherwise. */
  private async authHeaders(): Promise<Record<string, string>> {
    if (this.dtctlContext) {
      const token = await this.getBearerToken();
      return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    }
    return {
      Authorization: `Api-Token ${this.apiToken ?? ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async getBearerToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    const args = ['token', '--context', this.dtctlContext!];
    logger.debug(`Fetching Bearer token via dtctl context=${this.dtctlContext}`);
    const { stdout } = await execFileAsync('dtctl', args, { timeout: 10_000 });
    const raw = stdout.trim();
    // dtctl may return JSON or a plain token string
    let token: string;
    try {
      const parsed = JSON.parse(raw) as { access_token?: string; token?: string };
      token = parsed.access_token ?? parsed.token ?? raw;
    } catch {
      token = raw;
    }
    if (!token) throw new Error('dtctl returned an empty token');
    this.cachedToken = token;
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return token;
  }

  async executeDql(query: string): Promise<unknown> {
    if (this.dtctlContext) {
      return this.executeDqlViaDtctl(query);
    }
    return this.executeDqlViaApi(query);
  }

  private async executeDqlViaDtctl(query: string): Promise<unknown> {
    const args = ['query', query, '--context', this.dtctlContext!, '-o', 'json', '--plain'];
    logger.debug(`dtctl DQL via context=${this.dtctlContext}`);
    const t0 = Date.now();
    const { stdout } = await execFileAsync('dtctl', args, { timeout: 60_000 });
    const parsed = JSON.parse(stdout) as { records?: unknown[] };
    const records = parsed.records ?? [];
    logger.timing('dtctl DQL subprocess', Date.now() - t0, { records: (records as unknown[]).length });
    return records;
  }

  private async executeDqlViaApi(query: string): Promise<unknown> {
    const url = `${this.environmentUrl}/platform/storage/query/v1/query:execute`;
    const body = JSON.stringify({
      query,
      requestTimeoutMilliseconds: 30_000,
      fetchTimeoutSeconds: 30,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders(),
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
      return data.result?.records ?? [];
    }

    throw new Error(`Unexpected DQL response state: ${data.state}`);
  }

  async ingestBizevents(events: object[]): Promise<void> {
    const url = `${this.environmentUrl}/platform/ingest/v1/bizevents`;
    const response = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(events),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bizevent ingest failed (${response.status}): ${text}`);
    }
  }

  async ingestMetrics(lines: string): Promise<void> {
    const url = `${this.environmentUrl}/api/v2/metrics/ingest`;
    const headers = await this.authHeaders();
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
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
        headers: await this.authHeaders(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`DQL poll failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as DqlPollResponse;
      logger.debug(`DQL poll #${pollCount} state=${data.state} ${Date.now() - t0}ms`);

      if (data.state === 'SUCCEEDED') {
        return data.result?.records ?? [];
      }

      if (data.state === 'FAILED') {
        throw new Error('DQL query execution failed on the server');
      }
    }

    throw new Error(`DQL poll timed out after ${POLL_TIMEOUT_MS}ms`);
  }
}
