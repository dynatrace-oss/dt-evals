import { describe, expect, it } from 'vitest';
import { resolveConfiguredApiKey } from '../../../src/cli/commands/configure.js';

describe('resolveConfiguredApiKey', () => {
  it('keeps an existing key only for the same non-vertex provider', () => {
    expect(
      resolveConfiguredApiKey({ provider: 'openai', apiKey: 'old-openai-key' }, 'openai', undefined),
    ).toBe('old-openai-key');

    expect(
      resolveConfiguredApiKey({ provider: 'openai', apiKey: 'old-openai-key' }, 'anthropic', undefined),
    ).toBeUndefined();

    expect(
      resolveConfiguredApiKey({ provider: 'bedrock', apiKey: 'old-bedrock-key' }, 'bedrock', undefined),
    ).toBe('old-bedrock-key');

    expect(
      resolveConfiguredApiKey({ provider: 'openai', apiKey: 'old-openai-key' }, 'bedrock', undefined),
    ).toBeUndefined();
  });

  it('omits stale or blank API keys for vertex by default', () => {
    expect(
      resolveConfiguredApiKey({ provider: 'openai', apiKey: 'old-openai-key' }, 'vertex', undefined),
    ).toBeUndefined();

    expect(
      resolveConfiguredApiKey({ provider: 'vertex', apiKey: 'old-vertex-key' }, 'vertex', undefined),
    ).toBeUndefined();
  });

  it('preserves an existing vertex key only when explicitly requested', () => {
    expect(
      resolveConfiguredApiKey(
        { provider: 'vertex', apiKey: 'old-vertex-key' },
        'vertex',
        undefined,
        { preserveExistingVertexKey: true },
      ),
    ).toBe('old-vertex-key');
  });

  it('always prefers an explicitly entered key', () => {
    expect(
      resolveConfiguredApiKey({ provider: 'openai', apiKey: 'old-openai-key' }, 'vertex', 'new-vertex-key'),
    ).toBe('new-vertex-key');
  });
});
