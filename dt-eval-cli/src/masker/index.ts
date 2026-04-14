import type { GenAiSpan } from '../dt/types.js';

export interface MaskingConfig {
  patterns?: RegExp[]; // additional user-defined patterns
  enabled?: boolean;   // default true
}

const DEFAULT_PATTERNS: RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,              // email
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,          // phone US
  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g,  // credit card
  /\b\d{3}-\d{2}-\d{4}\b/g,                                              // SSN
];

const REDACTED = '[REDACTED]';

export function maskPii(text: string, config?: MaskingConfig): string {
  if (config?.enabled === false) {
    return text;
  }

  let result = text;
  const patterns = [...DEFAULT_PATTERNS, ...(config?.patterns ?? [])];

  for (const pattern of patterns) {
    // Reset lastIndex to ensure global patterns work correctly each time
    const resetPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    result = result.replace(resetPattern, REDACTED);
  }

  return result;
}

export function maskSpan(span: GenAiSpan, config?: MaskingConfig): GenAiSpan {
  if (config?.enabled === false) {
    return span;
  }

  return {
    ...span,
    input: maskPii(span.input, config),
    output: maskPii(span.output, config),
    systemInstruction: span.systemInstruction != null ? maskPii(span.systemInstruction, config) : span.systemInstruction,
  };
}
