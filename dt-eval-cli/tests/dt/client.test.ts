import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DynatraceClient } from '../../src/dt/client.js';
import { logger } from '../../src/logger/index.js';

const PLATFORM_TOKEN = 'dt0s16.AAAA.BBBB';
const CLASSIC_TOKEN = 'dt0c01.AAAA.BBBB';

function makeMockFetch(responses: Array<() => Response>): ReturnType<typeof vi.fn> {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const responseFn = responses[callIndex % responses.length];
    callIndex++;
    return Promise.resolve(responseFn?.() ?? new Response('', { status: 200 }));
  });
}

function makeSuccessResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

describe('DynatraceClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('executeDql sends correct URL and headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    await client.executeDql('fetch spans | limit 1');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.live.dynatrace.com/platform/storage/query/v1/query:execute');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${PLATFORM_TOKEN}`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('executeDql returns records when state=SUCCEEDED immediately', async () => {
    const records = [{ 'trace.id': 'abc', 'gen_ai.input.messages': 'q', 'gen_ai.output.message': 'a' }];
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records } }),
    );

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'token',
    });

    const result = await client.executeDql('fetch spans | limit 1');
    expect(result).toEqual(records);
  });

  it('executeDql polls when state=RUNNING and returns records on success', async () => {
    const records = [{ 'trace.id': 'poll-trace' }];
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeSuccessResponse({ state: 'RUNNING', requestToken: 'req-token-123' }))
      .mockResolvedValueOnce(makeSuccessResponse({ state: 'RUNNING' }))
      .mockResolvedValueOnce(makeSuccessResponse({ state: 'SUCCEEDED', result: { records } }));

    globalThis.fetch = mockFetch;

    // Mock setTimeout to avoid real delays
    vi.useFakeTimers();

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'token',
    });

    const resultPromise = client.executeDql('fetch spans | limit 1');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    vi.useRealTimers();
    expect(result).toEqual(records);
    // First call is execute, subsequent are polls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('executeDql throws on non-ok HTTP response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeErrorResponse(401, 'Unauthorized'));

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'bad-token',
    });

    await expect(client.executeDql('fetch spans')).rejects.toThrow('401');
  });

  it('executeDql throws when poll times out', async () => {
    // Return RUNNING state repeatedly — create fresh response each time
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('query:execute')) {
        return Promise.resolve(makeSuccessResponse({ state: 'RUNNING', requestToken: 'tok' }));
      }
      // Poll endpoint — always returns RUNNING
      return Promise.resolve(makeSuccessResponse({ state: 'RUNNING' }));
    });

    globalThis.fetch = mockFetch;

    vi.useFakeTimers();

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'token',
    });

    // Wrap in expect to ensure the rejection is handled
    const resultPromise = expect(client.executeDql('fetch spans')).rejects.toThrow(/timed out/i);
    // Advance time past POLL_TIMEOUT_MS (60000ms)
    await vi.advanceTimersByTimeAsync(65000);

    vi.useRealTimers();

    await resultPromise;
  });

  it('ingestBizevents sends correct URL and payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'token',
    });

    const events = [{ 'event.type': 'dt-eval.result' }];
    await client.ingestBizevents(events);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.live.dynatrace.com/api/v2/bizevents/ingest');
    expect(JSON.parse(init.body as string)).toEqual(events);
  });

  it('ingestBizevents throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeErrorResponse(403, 'Forbidden'));

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'token',
    });

    await expect(client.ingestBizevents([{}])).rejects.toThrow('403');
  });

  it('ingestMetrics sends text/plain content-type to /api/v2/metrics/ingest', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'token',
    });

    await client.ingestMetrics('my.metric 1.0');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.live.dynatrace.com/api/v2/metrics/ingest');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
  });

  it('ingest endpoints rewrite *.apps.dynatrace.com → *.live.dynatrace.com', async () => {
    // DQL lives on .apps.; classic env-api ingest lives on .live. Users supply
    // a single .apps. environmentUrl, so the client redirects ingest calls
    // to the matching .live. host.
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://abc12345.apps.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    await client.ingestBizevents([{ 'event.type': 'x' }]);
    await client.ingestMetrics('my.metric 1.0');

    const bizUrl = mockFetch.mock.calls[0]?.[0];
    const metricsUrl = mockFetch.mock.calls[1]?.[0];
    expect(bizUrl).toBe('https://abc12345.live.dynatrace.com/api/v2/bizevents/ingest');
    expect(metricsUrl).toBe('https://abc12345.live.dynatrace.com/api/v2/metrics/ingest');
  });

  it('ingest endpoints leave non-.apps. environmentUrls unchanged', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    globalThis.fetch = mockFetch;

    // Already on .live., or cluster-managed, or on-prem — pass through.
    for (const envUrl of [
      'https://my-cluster.live.dynatrace.com',
      'https://my-managed.dynatrace-managed.com',
      'https://localhost:8443',
    ]) {
      mockFetch.mockClear();
      const client = new DynatraceClient({ environmentUrl: envUrl, apiToken: PLATFORM_TOKEN });
      await client.ingestBizevents([{ 'event.type': 'x' }]);
      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toBe(`${envUrl.replace(/\/$/, '')}/api/v2/bizevents/ingest`);
    }
  });

  it('DQL queries stay on the original (not-rewritten) host', async () => {
    // The translation only applies to ingest. DQL must keep .apps.
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://abc12345.apps.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    await client.executeDql('fetch spans | limit 1');

    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toBe('https://abc12345.apps.dynatrace.com/platform/storage/query/v1/query:execute');
    expect(url).not.toContain('.live.');
  });

  it('platform tokens (dt0s*) use Bearer scheme', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    await client.executeDql('fetch spans | limit 1');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${PLATFORM_TOKEN}`);
  });

  it('classic API tokens (dt0c*) use Api-Token scheme', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: CLASSIC_TOKEN,
    });

    await client.executeDql('fetch spans | limit 1');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Api-Token ${CLASSIC_TOKEN}`);
  });

  it('logs WARNING-severity Grail notifications via logger.warn', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({
        state: 'SUCCEEDED',
        result: {
          records: [],
          metadata: {
            grail: {
              notifications: [
                {
                  severity: 'WARNING',
                  notificationType: 'MISSING_BUCKET_PERMISSIONS',
                  message: 'No bucket permissions for table spans.',
                },
              ],
            },
          },
        },
      }),
    );

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    await client.executeDql('fetch spans | limit 1');

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain('MISSING_BUCKET_PERMISSIONS');
    expect(warnSpy.mock.calls[0]?.[0]).toContain('No bucket permissions for table spans.');
  });

  it('probeBucketRead returns ok=true on a clean SUCCEEDED response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );
    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    const result = await client.probeBucketRead('spans');
    expect(result).toEqual({ ok: true });
  });

  it('probeBucketRead surfaces MISSING_BUCKET_PERMISSIONS as a failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({
        state: 'SUCCEEDED',
        result: {
          records: [],
          metadata: {
            grail: {
              notifications: [
                {
                  severity: 'WARNING',
                  notificationType: 'MISSING_BUCKET_PERMISSIONS',
                  message: 'No bucket permissions for table spans.',
                },
              ],
            },
          },
        },
      }),
    );
    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    const result = await client.probeBucketRead('spans');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('No bucket permissions');
    }
  });

  it('does not log when no notifications are present', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: PLATFORM_TOKEN,
    });

    await client.executeDql('fetch spans | limit 1');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('trailing slash in environmentUrl is stripped', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com/',
      apiToken: 'token',
    });

    await client.executeDql('fetch spans | limit 1');

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).not.toContain('//platform');
    expect(url).toContain('https://test.live.dynatrace.com/platform');
  });
});
