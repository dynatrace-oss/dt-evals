import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DynatraceClient } from '../../src/dt/client.js';

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
      apiToken: 'test-token-123',
    });

    await client.executeDql('fetch spans | limit 1');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.live.dynatrace.com/platform/storage/query/v1/query:execute');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Api-Token test-token-123');
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
    expect(url).toBe('https://test.live.dynatrace.com/platform/ingest/v1/bizevents');
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

  it('ingestMetrics sends text/plain content-type', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'token',
    });

    await client.ingestMetrics('my.metric 1.0');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
  });

  it('authorization header uses Api-Token format', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeSuccessResponse({ state: 'SUCCEEDED', result: { records: [] } }),
    );
    globalThis.fetch = mockFetch;

    const client = new DynatraceClient({
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'my-secret-token',
    });

    await client.executeDql('fetch spans | limit 1');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Api-Token my-secret-token');
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
