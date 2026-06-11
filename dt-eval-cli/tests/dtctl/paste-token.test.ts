import { describe, it, expect } from 'vitest';
import { looksLikePlatformToken, formatScopes, REQUIRED_SCOPES, PLATFORM_TOKENS_URL } from '../../src/dtctl/paste-token.js';

describe('looksLikePlatformToken', () => {
  it('accepts a typical platform token (dt0s16.<payload>)', () => {
    const token = 'dt0s16.' + 'A'.repeat(24) + '.' + 'B'.repeat(64);
    expect(looksLikePlatformToken(token)).toBe(true);
  });

  it('rejects empty / whitespace input', () => {
    expect(looksLikePlatformToken('')).toBe(false);
    expect(looksLikePlatformToken('   ')).toBe(false);
  });

  it('rejects obviously wrong shapes', () => {
    expect(looksLikePlatformToken('not-a-token')).toBe(false);
    expect(looksLikePlatformToken('Bearer eyJhbGciOi...')).toBe(false);
    // Right prefix but too short — almost certainly a paste error
    expect(looksLikePlatformToken('dt0s16.ABC')).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    const token = '  dt0s16.' + 'A'.repeat(64) + '\n';
    expect(looksLikePlatformToken(token)).toBe(true);
  });

  it('is case-insensitive on the prefix', () => {
    const token = 'DT0S16.' + 'A'.repeat(64);
    expect(looksLikePlatformToken(token)).toBe(true);
  });
});

describe('REQUIRED_SCOPES', () => {
  it('includes all four read/write scopes the runtime needs', () => {
    const scopes = REQUIRED_SCOPES.map(s => s.scope);
    expect(scopes).toContain('storage:spans:read');
    expect(scopes).toContain('storage:buckets:read');
    expect(scopes).toContain('storage:bizevents:read');
    expect(scopes).toContain('openpipeline:bizevents:ingest');
  });

  it('marks storage:metrics:write as optional', () => {
    const metrics = REQUIRED_SCOPES.find(s => s.scope === 'storage:metrics:write');
    expect(metrics?.optional).toBe(true);
  });
});

describe('formatScopes', () => {
  it('renders one line per scope with its purpose', () => {
    const out = formatScopes();
    const lines = out.split('\n');
    expect(lines).toHaveLength(REQUIRED_SCOPES.length);
    for (const s of REQUIRED_SCOPES) {
      expect(out).toContain(s.scope);
      expect(out).toContain(s.purpose);
    }
  });

  it('flags optional scopes', () => {
    expect(formatScopes()).toMatch(/optional/i);
  });
});

describe('PLATFORM_TOKENS_URL', () => {
  it('points at the official Dynatrace platform tokens page', () => {
    expect(PLATFORM_TOKENS_URL).toBe('https://myaccount.dynatrace.com/platformTokens');
  });
});
