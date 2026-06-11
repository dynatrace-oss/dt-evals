/**
 * End-to-end probe of a judge provider + model + credentials combination.
 *
 * Unlike the older "list models" / "is the API base URL reachable" check,
 * this fires a real minimal inference request with the configured model so
 * issues like a bogus model id (e.g. `sonnet` instead of `claude-sonnet-4-6`),
 * a wrong region for Bedrock, or a deployment name that doesn't exist on the
 * Azure OpenAI endpoint surface as the actual upstream error string.
 *
 * Used by both `dt-evals doctor` and `dt-evals validate`.
 */

import { DEFAULT_JUDGE_MODELS } from '../config/defaults.js';

export interface ProbeResult {
  ok: boolean;
  /** The model id the probe used (resolved from input or DEFAULT_JUDGE_MODELS). */
  model: string;
  /** Verbatim error string from the provider when ok=false; undefined on success. */
  error?: string;
}

export interface ProbeOptions {
  provider: string;
  apiKey?: string;
  /** AWS secret access key (Bedrock only). */
  secretKey?: string;
  model?: string;
  /** Azure OpenAI endpoint, custom OpenAI/Anthropic gateway, etc. */
  baseUrl?: string;
  /** Azure OpenAI api-version. */
  apiVersion?: string;
  /** AWS region (Bedrock only). */
  region?: string;
  /** Per-request timeout. Default 12s — long enough for cold-start cases. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 12_000;

/**
 * Trim a long provider error response to a single readable line so it fits
 * tidily in the doctor/validate output (and later in `runs show`). Strips
 * leading/trailing JSON whitespace, collapses newlines, caps at 280 chars.
 */
function compactError(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, 280);
}

async function readErrorBody(r: Response): Promise<string> {
  try {
    return compactError(await r.text());
  } catch {
    return `${r.status} ${r.statusText}`;
  }
}

export async function probeProvider(opts: ProbeOptions): Promise<ProbeResult> {
  const provider = opts.provider;
  const model = opts.model ?? DEFAULT_JUDGE_MODELS[provider] ?? 'unknown';
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  try {
    if (provider === 'openai') {
      const key = opts.apiKey ?? process.env['OPENAI_API_KEY'];
      if (!key) return { ok: false, model, error: 'No API key configured (set OPENAI_API_KEY or judge.apiKey)' };
      const base = (opts.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(timeout),
      });
      if (r.ok) return { ok: true, model };
      return { ok: false, model, error: `${r.status} ${await readErrorBody(r)}` };
    }

    if (provider === 'anthropic') {
      const key = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (!key) return { ok: false, model, error: 'No API key configured (set ANTHROPIC_API_KEY or judge.apiKey)' };
      const base = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
      const r = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
        signal: AbortSignal.timeout(timeout),
      });
      if (r.ok) return { ok: true, model };
      return { ok: false, model, error: `${r.status} ${await readErrorBody(r)}` };
    }

    if (provider === 'azure-openai') {
      const key = opts.apiKey ?? process.env['AZURE_OPENAI_API_KEY'];
      const endpoint = opts.baseUrl ?? process.env['AZURE_OPENAI_ENDPOINT'];
      const apiVersion = opts.apiVersion ?? process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-02-01';
      if (!key || !endpoint) return { ok: false, model, error: 'API key or endpoint not configured' };
      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${apiVersion}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(timeout),
      });
      if (r.ok) return { ok: true, model };
      return { ok: false, model, error: `${r.status} ${await readErrorBody(r)}` };
    }

    if (provider === 'gemini') {
      const key = opts.apiKey ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
      if (!key) return { ok: false, model, error: 'No API key configured (set GEMINI_API_KEY or judge.apiKey)' };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 1 } }),
        signal: AbortSignal.timeout(timeout),
      });
      if (r.ok) return { ok: true, model };
      return { ok: false, model, error: `${r.status} ${await readErrorBody(r)}` };
    }

    if (provider === 'bedrock') {
      const accessKeyId = opts.apiKey ?? process.env['AWS_ACCESS_KEY_ID'];
      const secretAccessKey = opts.secretKey ?? process.env['AWS_SECRET_ACCESS_KEY'];
      const region = opts.region ?? process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1';
      // Lazy-import so non-Bedrock users don't pay the SDK init cost on every doctor/validate run.
      const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({
        region,
        credentials: accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
      });
      try {
        await client.send(
          new ConverseCommand({
            modelId: model,
            messages: [{ role: 'user', content: [{ text: 'ok' }] }],
            inferenceConfig: { maxTokens: 1, temperature: 0 },
          }),
          { abortSignal: AbortSignal.timeout(timeout) },
        );
        return { ok: true, model };
      } catch (err) {
        return { ok: false, model, error: compactError((err as Error).message ?? String(err)) };
      }
    }

    return { ok: false, model, error: `Unknown provider: ${provider}` };
  } catch (err) {
    return { ok: false, model, error: compactError((err as Error).message ?? String(err)) };
  }
}
