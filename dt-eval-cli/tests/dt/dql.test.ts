import { describe, it, expect } from 'vitest';
import { buildGenAiSpanQuery, parseSpanResults } from '../../src/dt/dql.js';

describe('buildGenAiSpanQuery', () => {
  it('includes start_time filter with the given since value', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    expect(query).toContain('start_time > now() - 1h');
  });

  it('uses the correct since duration in filter', () => {
    const query24h = buildGenAiSpanQuery({ since: '24h' });
    expect(query24h).toContain('start_time > now() - 24h');

    const query6h = buildGenAiSpanQuery({ since: '6h' });
    expect(query6h).toContain('start_time > now() - 6h');
  });

  it('filters on both gen_ai.system and gen_ai.provider.name', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    expect(query).toContain('isNotNull(gen_ai.system)');
    expect(query).toContain('isNotNull(gen_ai.provider.name)');
  });

  it('filters by app when app is provided', () => {
    const query = buildGenAiSpanQuery({ since: '1h', app: 'my-service' });
    expect(query).toContain('my-service');
    expect(query).toContain('dt.smartscape.service');
  });

  it('does not include app filter when app is not provided', () => {
    const query = buildGenAiSpanQuery({ since: '1h' });
    expect(query).not.toContain('service.name');
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
    // OTel GenAI fields
    expect(query).toContain('gen_ai.input.messages');
    expect(query).toContain('gen_ai.output.message');
    expect(query).toContain('gen_ai.system');
    expect(query).toContain('trace.id');
    expect(query).toContain('start_time');
    // OpenLLMetry fields
    expect(query).toContain('gen_ai.provider.name');
    expect(query).toContain('gen_ai.prompt.0.content');
    expect(query).toContain('gen_ai.completion.0.content');
  });
});

describe('parseSpanResults', () => {
  it('maps fields correctly for a well-formed OTel GenAI record', () => {
    const records = [
      {
        'trace.id': 'abc123',
        'span.id': 'span001',
        'start_time': '2026-03-01T10:00:00Z',
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

  it('maps fields correctly for an OpenLLMetry record', () => {
    const records = [
      {
        'trace.id': 'llmetry-trace',
        'span.id': 'span002',
        'start_time': '2026-03-01T11:00:00Z',
        'gen_ai.prompt.0.role': 'system',
        'gen_ai.prompt.0.content': 'You are helpful.',
        'gen_ai.prompt.1.role': 'user',
        'gen_ai.prompt.1.content': 'What is Paris?',
        'gen_ai.completion.0.content': 'The capital of France.',
        'gen_ai.provider.name': 'openai',
        'gen_ai.request.model': 'gpt-4o-mini',
      },
    ];

    const spans = parseSpanResults(records);

    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.traceId).toBe('llmetry-trace');
    expect(span.timestamp).toBe('2026-03-01T11:00:00Z');
    expect(span.input).toContain('What is Paris?');
    expect(span.output).toBe('The capital of France.');
    expect(span.systemInstruction).toBe('You are helpful.');
    expect(span.system).toBe('openai');
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
    const records = [
      null,
      undefined,
      'string',
      42,
      // valid record with both input and output
      { 'trace.id': 'valid', 'gen_ai.input.messages': 'q', 'gen_ai.output.message': 'a' },
    ];
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

  it('falls back to gen_ai.provider.name when gen_ai.system is absent', () => {
    const records = [
      {
        'trace.id': 'provider-trace',
        'gen_ai.input.messages': 'q',
        'gen_ai.output.message': 'a',
        'gen_ai.provider.name': 'anthropic',
      },
    ];
    const spans = parseSpanResults(records);
    expect(spans[0]!.system).toBe('anthropic');
  });
});
