import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveSubdomain, createPlatformToken } from '../../src/dtctl/index.js';

describe('liveSubdomain', () => {
  it('rewrites *.apps.dynatrace.com to *.live.dynatrace.com', () => {
    expect(liveSubdomain('https://abc123.apps.dynatrace.com'))
      .toBe('https://abc123.live.dynatrace.com');
  });

  it('rewrites *.apps.dynatracelabs.com to *.dynatracelabs.com', () => {
    expect(liveSubdomain('https://abc123.apps.dynatracelabs.com'))
      .toBe('https://abc123.dynatracelabs.com');
  });

  it('preserves a path after the host', () => {
    expect(liveSubdomain('https://abc123.apps.dynatrace.com/api/v2/bizevents/ingest'))
      .toBe('https://abc123.live.dynatrace.com/api/v2/bizevents/ingest');
  });

  it('is idempotent on already-rewritten .live. URLs', () => {
    const url = 'https://abc123.live.dynatrace.com';
    expect(liveSubdomain(url)).toBe(url);
  });

  it('passes through on-prem / cluster URLs unchanged', () => {
    const url = 'https://my-cluster.internal.example.com';
    expect(liveSubdomain(url)).toBe(url);
  });
});

describe('createPlatformToken', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('posts /api/v2/apiTokens to the env-api host, not the apps gateway', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'tok-1', token: 'dt0c01.SECRET' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = mockFetch;

    await createPlatformToken('https://uim8926h.sprint.apps.dynatracelabs.com', 'bearer', 'n', ['s']);

    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://uim8926h.sprint.dynatracelabs.com/api/v2/apiTokens');
  });
});
