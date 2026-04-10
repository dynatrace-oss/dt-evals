import { describe, it, expect } from 'vitest';
import { buildGenAiSpanQuery, parseSpanResults } from '../../src/dt/dql.js';

describe('buildGenAiSpanQuery', () => {
  it('includes timestamp filter with the given since value', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    expect(query).toContain('timestamp > now() - 1h');
  });

  it('uses the correct since duration in filter', () => {
    const query24h = buildGenAiSpanQuery({ since: '24h' });
    expect(query24h).toContain('timestamp > now() - 24h');

    const query6h = buildGenAiSpanQuery({ since: '6h' });
    expect(query6h).toContain('timestamp > now() - 6h');
  });

  it('includes gen_ai.system not-null filter', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    expect(query).toContain('isNotNull(gen_ai.system)');
  });

  it('filters by app when app is provided', () => {
    const query = buildGenAiSpanQuery({ since: '1h', app: 'my-service' });
    expect(query).toContain('my-service');
  });

  it('does not include app filter when app is not provided', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    // Should not contain dt.entity.service or app.name filter
    expect(query).not.toContain('dt.entity.service');
    expect(query).not.toContain('app.name');
  });

  it('adds error filter when errorsOnly is true', () => {
    const query = buildGenAiSpanQuery({ since: '1h', errorsOnly: true });
    expect(query).toContain('ERROR');
  });

  it('does not add error filter when errorsOnly is false', () => {
    const query = buildGenAiSpanQuery({ since: '1h', errorsOnly: false });
    expect(query).not.toContain('status.code == "ERROR"');
  });

  it('includes a limit clause', () => {
    const query = buildGenAiSpanQuery({ since: '1h', limit: 500 });
    expect(query).toContain('limit 500');
  });

  it('uses default limit of 1000 when not specified', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    expect(query).toContain('limit 1000');
  });

  it('includes required fields in the fields clause', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    expect(query).toContain('gen_ai.input.messages');
    expect(query).toContain('gen_ai.output.message');
    expect(query).toContain('gen_ai.system');
    expect(query).toContain('trace.id');
    expect(query).toContain('timestamp');
  });
});

describe('parseSpanResults', () => {
  it('maps fields correctly for a well-formed record', () => {
    const records = [
      {
        'trace.id': 'abc123',
        'span.id': 'span001',
        timestamp: '2026-03-01T10:00:00Z',
        'gen_ai.input.messages': '[{"role":"user","content":"Hello"}]',
        'gen_ai.output.message': 'Hi there!',
        'gen_ai.system_instruction': 'Be helpful.',
        'gen_ai.system': 'openai',
        'gen_ai.request.model': 'gpt-4o',
        'status.code': 'OK',
      },
    ];

    const spans = parseSpanResults(records);

    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.traceId).toBe('abc123');
    expect(span.spanId).toBe('span001');
    expect(span.timestamp).toBe('2026-03-01T10:00:00Z');
    expect(span.input).toBe('[{"role":"user","content":"Hello"}]');
    expect(span.output).toBe('Hi there!');
    expect(span.systemInstruction).toBe('Be helpful.');
    expect(span.system).toBe('openai');
    expect(span.requestModel).toBe('gpt-4o');
    expect(span.isError).toBeUndefined();
  });

  it('handles missing optional fields gracefully', () => {
    const records = [
      {
        'trace.id': 'trace-min',
        'gen_ai.input.messages': 'question',
        'gen_ai.output.message': 'answer',
      },
    ];

    const spans = parseSpanResults(records);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.traceId).toBe('trace-min');
    expect(span.spanId).toBeUndefined();
    expect(span.systemInstruction).toBeUndefined();
    expect(span.system).toBeUndefined();
    expect(span.requestModel).toBeUndefined();
  });

  it('skips records with no traceId', () => {
    const records = [
      { 'gen_ai.input.messages': 'q', 'gen_ai.output.message': 'a' },
      { 'trace.id': 'valid-trace', 'gen_ai.input.messages': 'q2', 'gen_ai.output.message': 'a2' },
    ];

    const spans = parseSpanResults(records);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.traceId).toBe('valid-trace');
  });

  it('skips null and non-object records', () => {
    const records = [null, undefined, 'string', 42, { 'trace.id': 'valid' }];
    const spans = parseSpanResults(records as unknown[]);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.traceId).toBe('valid');
  });

  it('marks span as isError when status.code is ERROR', () => {
    const records = [
      {
        'trace.id': 'err-trace',
        'gen_ai.input.messages': 'q',
        'gen_ai.output.message': 'a',
        'status.code': 'ERROR',
      },
    ];

    const spans = parseSpanResults(records);
    expect(spans[0]!.isError).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(parseSpanResults([])).toEqual([]);
  });

  it('handles object-typed input messages by stringifying', () => {
    const records = [
      {
        'trace.id': 'obj-input',
        'gen_ai.input.messages': [{ role: 'user', content: 'Hello' }],
        'gen_ai.output.message': 'Hi',
      },
    ];

    const spans = parseSpanResults(records);
    expect(spans[0]!.input).toBe('[{"role":"user","content":"Hello"}]');
  });
});
