/**
 * Thin Dynatrace DQL client for the E2E suite, deliberately independent of
 * `dt-eval-cli/src/dt/client.ts` — the suite must observe the tenant without
 * trusting the code under test. Hits the same endpoints the CLI does.
 */

import { redactSecrets } from './assert.js';
import { dtHttpTimeoutMs } from './env.js';

export type DqlRecord = Record<string, unknown>;

/** How much longer than a single request a RUNNING query may take overall. */
const POLL_DEADLINE_FACTOR = 3;

/** A non-retryable query failure (bad token, missing scope, malformed DQL) — fails fast instead of stalling until the deadline. */
export class PermanentQueryError extends Error {}

/** Pick the Authorization scheme: `dt0c*` classic tokens use `Api-Token`; platform/OAuth tokens use `Bearer`. */
function authScheme(token: string): 'Bearer' | 'Api-Token' {
  return token.startsWith('dt0c') ? 'Api-Token' : 'Bearer';
}

interface QueryResponse {
  state?: string;
  requestToken?: string;
  result?: { records?: DqlRecord[] } | null;
  error?: { code?: number; message?: string } | null;
}

export class DynatraceClient {
  private readonly endpoint: string;
  /** Pre-built header value. The raw token is not retained as a field. */
  private readonly authorization: string;
  private readonly timeoutMs: number;

  constructor(appsEndpoint: string, apiToken: string, timeoutMs = dtHttpTimeoutMs()) {
    this.endpoint = appsEndpoint.replace(/\/+$/, '');
    this.authorization = `${authScheme(apiToken)} ${apiToken}`;
    this.timeoutMs = timeoutMs;
  }

  /** Run a query once and return whatever records the tenant returns. No retry. */
  async execute(dql: string): Promise<DqlRecord[]> {
    const response = await this.post(dql);

    if (response.error) {
      throw new Error(
        redactSecrets(
          `DT API error ${response.error.code ?? '?'}: ${response.error.message ?? ''}`,
        ),
      );
    }
    if (response.state === 'RUNNING' && response.requestToken) {
      return this.poll(response.requestToken);
    }
    if (response.state !== 'SUCCEEDED') {
      throw new Error(`unexpected query state: ${response.state ?? '<none>'}`);
    }
    return response.result?.records ?? [];
  }

  /**
   * Re-run `dql` until it returns at least `minRecords` records, or
   * `timeoutMs` elapses — ingestion isn't atomic, so a bare non-empty check
   * made a correct run fail intermittently. Returns the last observed result
   * on timeout so the caller can report "got 1 of 2" instead of a bare timeout.
   */
  async pollUntilRecords(
    dql: string,
    {
      timeoutMs,
      intervalMs = 15_000,
      minRecords = 1,
    }: { timeoutMs: number; intervalMs?: number; minRecords?: number },
  ): Promise<DqlRecord[]> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    let best: DqlRecord[] = [];

    for (;;) {
      try {
        const records = await this.execute(dql);
        if (records.length > best.length) best = records;
        if (records.length >= minRecords) return records;
      } catch (err) {
        // A 4xx won't fix itself; retrying just delays the report.
        if (err instanceof PermanentQueryError) throw err;
        lastError = err;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        if (best.length > 0) return best;
        const suffix = lastError ? ` (last query error: ${(lastError as Error).message})` : '';
        throw new Error(
          `timed out after ${timeoutMs}ms waiting for ${minRecords} DQL record(s)${suffix}\nquery:\n${dql}`,
        );
      }
      await sleep(Math.min(intervalMs, remaining));
    }
  }

  private async post(dql: string): Promise<QueryResponse> {
    const response = await this.fetchWithTimeout(
      `${this.endpoint}/platform/storage/query/v1/query:execute`,
      {
        method: 'POST',
        headers: {
          Authorization: this.authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: dql, requestTimeoutMilliseconds: 25_000 }),
      },
    );
    return this.decode(response);
  }

  /** Follow a RUNNING query to completion, bounded by its own deadline (not just per-request timeouts). */
  private async poll(requestToken: string): Promise<DqlRecord[]> {
    const deadline = Date.now() + this.timeoutMs * POLL_DEADLINE_FACTOR;

    for (;;) {
      if (Date.now() > deadline) {
        throw new Error(
          `query still RUNNING after ${Math.round((this.timeoutMs * POLL_DEADLINE_FACTOR) / 1000)}s`,
        );
      }
      const response = await this.fetchWithTimeout(
        `${this.endpoint}/platform/storage/query/v1/query:poll?requestToken=${encodeURIComponent(requestToken)}`,
        { headers: { Authorization: this.authorization } },
      );
      const body = await this.decode(response);

      switch (body.state) {
        case 'SUCCEEDED':
          return body.result?.records ?? [];
        case 'RUNNING':
          await sleep(2_000);
          break;
        default:
          throw new Error(
            redactSecrets(`query failed: ${body.error?.message ?? body.state ?? '<none>'}`),
          );
      }
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      // Node's bare "fetch failed" names neither host nor reason; say which host and why.
      const cause = (err as { cause?: Error }).cause;
      throw new Error(
        redactSecrets(
          `request to ${new URL(url).origin} failed: ${cause?.message ?? (err as Error).message}`,
        ),
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Decode a platform-storage response, surfacing HTTP errors with their body (usually names a missing scope). */
  private async decode(response: Response): Promise<QueryResponse> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = redactSecrets(`DT API returned HTTP ${response.status}: ${body}`);
      // 4xx is a verdict, not a hiccup — except 408/429, which invite a retry.
      const permanent =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429;
      throw permanent ? new PermanentQueryError(message) : new Error(message);
    }
    return (await response.json()) as QueryResponse;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
