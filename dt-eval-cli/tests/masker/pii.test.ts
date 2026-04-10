import { describe, it, expect } from 'vitest';
import { maskPii, maskSpan } from '../../src/masker/index.js';
import type { GenAiSpan } from '../../src/dt/types.js';

function makeSpan(overrides?: Partial<GenAiSpan>): GenAiSpan {
  return {
    traceId: 'trace-abc-123',
    timestamp: '2026-03-01T10:00:00Z',
    input: 'Hello world',
    output: 'Hi there',
    ...overrides,
  };
}

describe('maskPii', () => {
  it('masks email addresses', () => {
    const result = maskPii('Contact me at user@example.com for details');
    expect(result).not.toContain('user@example.com');
    expect(result).toContain('[REDACTED]');
  });

  it('masks multiple email addresses in one string', () => {
    const result = maskPii('Email alice@test.com or bob@example.org');
    expect(result).not.toContain('alice@test.com');
    expect(result).not.toContain('bob@example.org');
    const redactedCount = (result.match(/\[REDACTED\]/g) ?? []).length;
    expect(redactedCount).toBe(2);
  });

  it('masks US phone numbers', () => {
    const result = maskPii('Call me at 555-867-5309 anytime');
    expect(result).not.toContain('555-867-5309');
    expect(result).toContain('[REDACTED]');
  });

  it('masks US phone numbers with different formats', () => {
    const inputs = ['(800) 555-1234', '800.555.1234', '+1 800 555 1234'];
    for (const phone of inputs) {
      const result = maskPii(`Call ${phone}`);
      expect(result).not.toContain(phone);
    }
  });

  it('masks credit card numbers (Visa)', () => {
    const result = maskPii('My card is 4111111111111111');
    expect(result).not.toContain('4111111111111111');
    expect(result).toContain('[REDACTED]');
  });

  it('masks credit card numbers (Mastercard)', () => {
    const result = maskPii('Use card 5500005555555559');
    expect(result).not.toContain('5500005555555559');
    expect(result).toContain('[REDACTED]');
  });

  it('masks SSNs', () => {
    const result = maskPii('SSN: 123-45-6789');
    expect(result).not.toContain('123-45-6789');
    expect(result).toContain('[REDACTED]');
  });

  it('leaves non-PII text unchanged', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    expect(maskPii(text)).toBe(text);
  });

  it('multiple PII patterns in one string are all masked', () => {
    const text = 'Email: admin@corp.com, SSN: 987-65-4320, Phone: 415-555-0100';
    const result = maskPii(text);
    expect(result).not.toContain('admin@corp.com');
    expect(result).not.toContain('987-65-4320');
    expect(result).not.toContain('415-555-0100');
    const redactedCount = (result.match(/\[REDACTED\]/g) ?? []).length;
    expect(redactedCount).toBeGreaterThanOrEqual(3);
  });

  it('applies custom patterns', () => {
    const customPattern = /\b[A-Z]{2}\d{6}\b/g; // passport-like: AB123456
    const result = maskPii('Passport: AB123456', { patterns: [customPattern] });
    expect(result).not.toContain('AB123456');
    expect(result).toContain('[REDACTED]');
  });

  it('returns original text when masking is disabled', () => {
    const text = 'Email: user@example.com';
    expect(maskPii(text, { enabled: false })).toBe(text);
  });

  it('handles empty string without error', () => {
    expect(maskPii('')).toBe('');
  });
});

describe('maskSpan', () => {
  it('masks input field', () => {
    const span = makeSpan({ input: 'My email is user@example.com' });
    const masked = maskSpan(span);
    expect(masked.input).not.toContain('user@example.com');
    expect(masked.input).toContain('[REDACTED]');
  });

  it('masks output field', () => {
    const span = makeSpan({ output: 'Your SSN is 123-45-6789' });
    const masked = maskSpan(span);
    expect(masked.output).not.toContain('123-45-6789');
    expect(masked.output).toContain('[REDACTED]');
  });

  it('masks systemInstruction field when present', () => {
    const span = makeSpan({ systemInstruction: 'Contact admin@corp.com for issues' });
    const masked = maskSpan(span);
    expect(masked.systemInstruction).not.toContain('admin@corp.com');
    expect(masked.systemInstruction).toContain('[REDACTED]');
  });

  it('leaves traceId unchanged', () => {
    const span = makeSpan({ traceId: 'trace-abc-123', input: 'user@test.com' });
    const masked = maskSpan(span);
    expect(masked.traceId).toBe('trace-abc-123');
  });

  it('leaves spanId unchanged', () => {
    const span = makeSpan({ spanId: 'span-001', input: 'user@test.com' });
    const masked = maskSpan(span);
    expect(masked.spanId).toBe('span-001');
  });

  it('leaves timestamp unchanged', () => {
    const span = makeSpan({ timestamp: '2026-03-01T10:00:00Z', input: 'user@test.com' });
    const masked = maskSpan(span);
    expect(masked.timestamp).toBe('2026-03-01T10:00:00Z');
  });

  it('returns a new span object (does not mutate original)', () => {
    const span = makeSpan({ input: 'user@test.com' });
    const masked = maskSpan(span);
    expect(masked).not.toBe(span);
    expect(span.input).toBe('user@test.com'); // original unchanged
  });

  it('returns original span when masking is disabled', () => {
    const span = makeSpan({ input: 'user@test.com' });
    const result = maskSpan(span, { enabled: false });
    expect(result).toBe(span);
    expect(result.input).toBe('user@test.com');
  });

  it('handles span with undefined systemInstruction gracefully', () => {
    const span = makeSpan({ systemInstruction: undefined });
    const masked = maskSpan(span);
    expect(masked.systemInstruction).toBeUndefined();
  });
});
