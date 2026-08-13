import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeProvider } from '../../src/probe/provider.js';

// Capturing mock for the dynamically-imported Bedrock SDK so we can assert
// which credentials the probe forwards to BedrockRuntimeClient.
const bedrockClientCtor = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
  BedrockRuntimeClient: bedrockClientCtor.mockImplementation(function () {
    return { send: vi.fn().mockResolvedValue({ output: { message: { content: [{ text: 'ok' }] } } }) };
  }),
  // biome-ignore lint/complexity/useArrowFunction: function expression required for new-able mock in vitest 4.x
  ConverseCommand: vi.fn().mockImplementation(function (input: unknown) {
    return input;
  }),
}));

describe('probeProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean slate for env vars the probe consults as fallbacks.
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['AZURE_OPENAI_API_KEY'];
    delete process.env['AZURE_OPENAI_ENDPOINT'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns error when API key is not set', async () => {
    const r = await probeProvider({ provider: 'openai', model: 'gpt-4.1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/API key/);
    expect(r.model).toBe('gpt-4.1');
  });

  it('anthropic: 404 model-not-found bubbles up verbatim', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '{"type":"error","error":{"type":"not_found_error","message":"model: sonnet"}}',
    } as unknown as Response);

    const r = await probeProvider({ provider: 'anthropic', apiKey: 'sk-test', model: 'sonnet' });
    expect(r.ok).toBe(false);
    expect(r.model).toBe('sonnet');
    expect(r.error).toContain('404');
    expect(r.error).toContain('model: sonnet');
  });

  it('openai: 200 success returns ok=true', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as unknown as Response);

    const r = await probeProvider({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4.1' });
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.model).toBe('gpt-4.1');
  });

  it('openai: POSTs to /v1/chat/completions, not /v1/models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' } as unknown as Response);
    global.fetch = fetchMock;

    await probeProvider({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4.1' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { model: string; max_tokens: number };
    expect(body.model).toBe('gpt-4.1');
    expect(body.max_tokens).toBe(1);
  });

  it('gemini: encodes model into URL path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' } as unknown as Response);
    global.fetch = fetchMock;

    await probeProvider({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(url).toContain('key=k');
  });

  it('azure-openai: builds deployment URL from baseUrl + model', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' } as unknown as Response);
    global.fetch = fetchMock;

    await probeProvider({
      provider: 'azure-openai',
      apiKey: 'k',
      model: 'my-deployment',
      baseUrl: 'https://my-resource.openai.azure.com/',
      apiVersion: '2024-02-01',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://my-resource.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2024-02-01');
    expect((init.headers as Record<string, string>)['api-key']).toBe('k');
  });

  it('unknown provider returns ok=false with descriptive error', async () => {
    const r = await probeProvider({ provider: 'something-else', apiKey: 'k', model: 'foo' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown provider/);
  });

  it('falls back to DEFAULT_JUDGE_MODELS when model is unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' } as unknown as Response);
    global.fetch = fetchMock;

    const r = await probeProvider({ provider: 'anthropic', apiKey: 'k' });
    expect(r.model).not.toBe('unknown');
    expect(r.model).toMatch(/claude/i);
  });
});

describe('probeProvider — bedrock', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    bedrockClientCtor.mockReset();
    bedrockClientCtor.mockImplementation(function () {
      return { send: vi.fn().mockResolvedValue({ output: { message: { content: [{ text: 'ok' }] } } }) };
    });
    delete process.env['AWS_ACCESS_KEY_ID'];
    delete process.env['AWS_SECRET_ACCESS_KEY'];
    delete process.env['AWS_SESSION_TOKEN'];
    delete process.env['AWS_REGION'];
    delete process.env['AWS_DEFAULT_REGION'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function lastCredentials(): unknown {
    const calls = bedrockClientCtor.mock.calls;
    return (calls[calls.length - 1][0] as { credentials?: unknown }).credentials;
  }

  it('leaves credentials undefined for SSO/env temporary creds so the default chain signs with the session token', async () => {
    process.env['AWS_ACCESS_KEY_ID'] = 'env-key';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'env-secret';
    process.env['AWS_SESSION_TOKEN'] = 'session-tok';

    const r = await probeProvider({ provider: 'bedrock', model: 'us.amazon.nova-2-lite-v1:0' });

    expect(r.ok).toBe(true);
    expect(lastCredentials()).toBeUndefined();
  });

  it('builds explicit credentials from configured static apiKey + secretKey', async () => {
    await probeProvider({ provider: 'bedrock', apiKey: 'AKIA', secretKey: 'secret', model: 'm' });

    expect(lastCredentials()).toEqual({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    });
  });
});
