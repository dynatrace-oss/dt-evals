import { describe, it, expect } from 'vitest';
import { suggestModelForProvider, DEFAULT_JUDGE_MODELS } from '../src/config/defaults.js';
import type { DtEvalConfig } from '../src/config/schema.js';

type Provider = DtEvalConfig['judge']['provider'];

// Derive everything from the single source of truth so updating a model name in
// defaults.ts never breaks these tests — they assert the routing logic, not the
// literal model strings.
const providersWithDefault = Object.keys(DEFAULT_JUDGE_MODELS) as Provider[];

describe('suggestModelForProvider', () => {
  it('suggests each provider default from DEFAULT_JUDGE_MODELS when no existing config', () => {
    expect(providersWithDefault.length).toBeGreaterThan(0);
    for (const provider of providersWithDefault) {
      expect(suggestModelForProvider(provider)).toBe(DEFAULT_JUDGE_MODELS[provider]);
    }
  });

  // Regression for AI-315: switching provider must not carry over the previous
  // provider's model (e.g. an OpenAI default filled in by resolveEffectiveConfig).
  it('ignores the existing model when the provider changed', () => {
    const stale = DEFAULT_JUDGE_MODELS['openai'];
    for (const provider of providersWithDefault) {
      if (provider === 'openai') continue;
      expect(suggestModelForProvider(provider, 'openai', stale)).toBe(
        DEFAULT_JUDGE_MODELS[provider],
      );
      expect(suggestModelForProvider(provider, 'openai', stale)).not.toBe(stale);
    }
  });

  it('reuses the existing model when the provider is unchanged', () => {
    // Arbitrary, intentionally non-default models a user might have typed — these
    // are user input, not our source of truth, so literals are correct here.
    const customOpenai = 'gpt-4o';
    const customAnthropic = 'claude-opus-4-8';
    expect(customOpenai).not.toBe(DEFAULT_JUDGE_MODELS['openai']);
    expect(suggestModelForProvider('openai', 'openai', customOpenai)).toBe(customOpenai);
    expect(suggestModelForProvider('anthropic', 'anthropic', customAnthropic)).toBe(
      customAnthropic,
    );
  });

  it('returns empty string for providers without a default (azure-openai)', () => {
    // Guard the premise: azure-openai genuinely has no entry in the map.
    expect(DEFAULT_JUDGE_MODELS['azure-openai']).toBeUndefined();
    expect(suggestModelForProvider('azure-openai')).toBe('');
    // Even coming from another provider, no default deployment name can be guessed.
    expect(
      suggestModelForProvider('azure-openai', 'openai', DEFAULT_JUDGE_MODELS['openai']),
    ).toBe('');
  });

  it('falls back to the provider default when existing model is empty', () => {
    const def = DEFAULT_JUDGE_MODELS['openai'];
    expect(suggestModelForProvider('openai', 'openai', '')).toBe(def);
    expect(suggestModelForProvider('openai', 'openai', undefined)).toBe(def);
  });
});
