/**
 * Thin Dynatrace DQL client for the E2E suite.
 *
 * Ported from `test/e2e/internal/dynatrace/client.go` in the
 * instrumentation-examples repo, and deliberately independent of
 * `dt-eval-cli/src/dt/client.ts`: the suite must be able to observe the tenant
 * without trusting the code under test. If the CLI's own client regresses, this
 * one still reports the truth.
 *
 * Hits the same endpoints the CLI does (`dt-eval-cli/src/dt/client.ts:119`):
 * `POST /platform/storage/query/v1/query:execute`, then
 * `GET /platform/storage/query/v1/query:poll` while the query is RUNNING.
 */

import { dtHttpTimeoutMs } from './env.js';

export type DqlRecord = Record<string, unknown>;

/**
 * How much longer than a single request a RUNNING query may take overall.
 *
 * A query that goes async is expected to outlast one HTTP timeout — that is why
 * it went async — so the ceiling is a multiple of it rather than the same value.
 */
const POLL_DEADLINE_FACTOR = 3;

/**
 * A query failure that repeating cannot fix — a rejected token, a missing
 * scope, malformed DQL. Distinguished from a transient one so
 * {@link DynatraceClient.pollUntilRecords} can fail fast instead of retrying
 * until its deadline and then blaming the timeout.
 */
export class PermanentQueryError extends Error {}

/**
 * Pick the Authorization scheme for a token, mirroring `authScheme()` in
 * `dt-eval-cli/src/dt/client.ts:9`.
 *
 * Deliberately identical to the CLI's rule rather than hardcoding one scheme:
 *   - `dt0c*` classic API tokens use `Api-Token`;
 *   - platform tokens (`dt0s*`) and OAuth bearer tokens use `Bearer`.
 *
 * The instrumentation-examples Go client hardcodes `Api-Token`, which works
 * there because that suite is only ever given a classic token. Copying that
 * would have quietly locked this suite out of platform tokens and OAuth
 * credentials — the two things a Dynatrace tenant hands out today.
 */
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
      throw new Error(`DT API error ${response.error.code ?? '?'}: ${response.error.message ?? ''}`);
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
   * Re-run `dql` until it returns at least `minRecords` records, or `timeoutMs`
   * elapses.
   *
   * `minRecords` exists because ingestion is not atomic: a caller waiting for
   * the two bizevents a run wrote can see the first one surface a poll interval
   * before the second. Returning on the first non-empty result and then
   * asserting an exact count outside made a correct run fail intermittently, so
   * the expected count belongs in the wait condition rather than after it.
   *
   * The last observed result is returned on timeout rather than thrown away, so
   * the caller's own assertion reports "got 1 of 2" instead of a bare timeout.
   *
   * Transient query failures — slow gateway, HTTP timeout, 5xx — do not abort
   * the poll; they are remembered and only surfaced if the deadline is hit. A
   * single flaky query should not fail a test that would have passed one
   * interval later.
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
        // A 4xx will not fix itself: a bad token, a missing scope or a DQL
        // syntax error returns the same answer on every retry, so retrying only
        // delays the report by the full timeout and buries the cause behind
        // "timed out waiting for records".
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

  /**
   * Follow a RUNNING query to completion.
   *
   * Bounded by its own deadline. Each request has a timeout, but the loop
   * around them did not, so a query that stayed RUNNING would spin until
   * vitest's test timeout killed it — reported as "the test took too long"
   * rather than "the tenant never finished this query".
   */
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
          throw new Error(`query failed: ${body.error?.message ?? body.state ?? '<none>'}`);
      }
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      // Node's bare "fetch failed" names neither the host nor the reason, and
      // pointing at the wrong tenant — a DNS failure — is the single most
      // common way this suite goes red. Say which host and why.
      const cause = (err as { cause?: Error }).cause;
      throw new Error(
        `request to ${new URL(url).origin} failed: ${cause?.message ?? (err as Error).message}`,
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Decode a platform-storage response, surfacing HTTP errors with their body.
   *
   * The body is included because a 403 here is almost always a missing token
   * scope, and the tenant names the scope in the response. Note this is the one
   * place the suite handles raw tenant output: callers that log it must run it
   * through `assertNoSecrets` first.
   */
  private async decode(response: Response): Promise<QueryResponse> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = `DT API returned HTTP ${response.status}: ${body}`;
      // 4xx is a verdict, not a hiccup — retrying it just wastes the deadline.
      // 408 and 429 are the exceptions: both explicitly invite a retry.
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
