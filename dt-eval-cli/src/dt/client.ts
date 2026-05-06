import { logger } from '../logger/index.js';

export interface DynatraceClientConfig {
  environmentUrl: string;
  apiToken?: string;
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

export class DynatraceClient {
  private readonly environmentUrl: string;
  private readonly apiToken: string;

  constructor(config: DynatraceClientConfig) {
    this.environmentUrl = config.environmentUrl.replace(/\/$/, '');
    this.apiToken = config.apiToken ?? '';
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Api-Token ${this.apiToken}`,
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
        return data.result?.records ?? [];
      }

      if (data.state === 'FAILED') {
        throw new Error('DQL query execution failed on the server');
      }
    }

    throw new Error(`DQL poll timed out after ${POLL_TIMEOUT_MS}ms`);
  }
}
