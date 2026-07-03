import { describe, it, expect, vi } from 'vitest';
import { buildBizeventPayload, BizeventWriter } from '../../src/dt/bizevent.js';
import type { GenAiSpan } from '../../src/dt/types.js';
import type { EvalResult } from '@dynatrace-oss/dt-eval-lib';

function makeSpan(overrides?: Partial<GenAiSpan>): GenAiSpan {
  return {
    traceId: 'trace-abc-123',
    spanId: 'span-001',
    timestamp: '2026-03-01T10:00:00Z',
    input: 'What is the capital of France?',
    output: 'Paris.',
    system: 'openai',
    requestModel: 'gpt-4o',
    ...overrides,
  };
}

function makeEvalResult(scoreValue = 0.9, scoreLabel: 'pass' | 'fail' = 'pass', summary = 'Response is accurate and helpful.'): EvalResult {
  return {
    score: { value: scoreValue, label: scoreLabel },
    explanation: { summary },
  };
}

describe('buildBizeventPayload', () => {
  it('produces a payload with the correct schema fields', () => {
    const span = makeSpan();
    const result = makeEvalResult();
    const payload = buildBizeventPayload(span, 'relevance', 'Relevance', result, 'run-001', 'openai', 'gpt-4o');

    expect(payload['event.type']).toBe('gen_ai.evaluation.result');
    expect(payload['event.provider']).toBe('dt-eval-cli');
    expect(payload['trace_id']).toBe('trace-abc-123');
    expect(payload['dt.eval.run_id']).toBe('run-001');
    expect(payload['gen_ai.evaluation.name']).toBe('Relevance');
    expect(payload['gen_ai.evaluation.spec_id']).toBe('relevance');
    expect(payload['gen_ai.evaluation.score.value']).toBe(0.9);
    expect(payload['gen_ai.provider.name']).toBe('openai');
    expect(payload['gen_ai.request.model']).toBe('gpt-4o');
  });

  it('sets event.type to "gen_ai.evaluation.result"', () => {
    const payload = buildBizeventPayload(makeSpan(), 'toxicity', 'Toxicity', makeEvalResult(), 'run-1', 'anthropic', 'claude');
    expect(payload['event.type']).toBe('gen_ai.evaluation.result');
  });

  it('sets score label to "pass" from eval result', () => {
    const result = makeEvalResult(0.9, 'pass');
    const payload = buildBizeventPayload(makeSpan(), 'relevance', 'Relevance', result, 'run-1', 'openai', 'gpt-4o');
    expect(payload['gen_ai.evaluation.score.label']).toBe('pass');
  });

  it('sets score label to "fail" from eval result', () => {
    const result = makeEvalResult(0.1, 'fail');
    const payload = buildBizeventPayload(makeSpan(), 'toxicity', 'Toxicity', result, 'run-1', 'openai', 'gpt-4o');
    expect(payload['gen_ai.evaluation.score.label']).toBe('fail');
  });

  it('uses the exact score.value from EvalResult', () => {
    const result = makeEvalResult(0.75, 'pass');
    const payload = buildBizeventPayload(makeSpan(), 'user-frustration', 'User Frustration', result, 'run-1', 'openai', 'gpt-4o');
    expect(payload['gen_ai.evaluation.score.value']).toBe(0.75);
  });

  it('uses explanation.summary as the explanation string', () => {
    const result = makeEvalResult(1, 'pass', 'No harmful content detected.');
    const payload = buildBizeventPayload(makeSpan(), 'toxicity', 'Toxicity', result, 'run-1', 'openai', 'gpt-4o');
    expect(payload['gen_ai.evaluation.explanation']).toBe('No harmful content detected.');
  });

  it('includes judge provider and model metadata', () => {
    const payload = buildBizeventPayload(makeSpan(), 'faithfulness', 'Faithfulness', makeEvalResult(), 'run-1', 'anthropic', 'claude-sonnet-4-6');
    expect(payload['gen_ai.provider.name']).toBe('anthropic');
    expect(payload['gen_ai.request.model']).toBe('claude-sonnet-4-6');
  });

  it('omits gen_ai.system when span.system is absent', () => {
    const span = makeSpan({ system: undefined });
    const payload = buildBizeventPayload(span, 'relevance', 'Relevance', makeEvalResult(), 'run-1', 'openai', 'gpt-4o');
    // gen_ai.system is not part of the dt-ai-ingest schema; only gen_ai.provider.name is used
    expect(payload['gen_ai.provider.name']).toBe('openai');
  });

  it('includes a valid ISO timestamp field', () => {
    const payload = buildBizeventPayload(makeSpan(), 'toxicity', 'Toxicity', makeEvalResult(), 'run-1', 'openai', 'gpt-4o');
    expect(payload.timestamp).toBeDefined();
    expect(new Date(payload.timestamp!).toISOString()).toBe(payload.timestamp);
  });

  describe('storeEvaluatedPrompt', () => {
    it('omits the evaluated question/answer/system_prompt by default', () => {
      const span = makeSpan({ systemInstruction: 'be helpful' });
      const payload = buildBizeventPayload(span, 'relevance', 'Relevance', makeEvalResult(), 'run-1', 'openai', 'gpt-4o');
      expect(payload['gen_ai.evaluation.input.question']).toBeUndefined();
      expect(payload['gen_ai.evaluation.input.answer']).toBeUndefined();
      expect(payload['gen_ai.evaluation.input.system_prompt']).toBeUndefined();
    });

    it('omits them when explicitly disabled', () => {
      const span = makeSpan({ systemInstruction: 'be helpful' });
      const payload = buildBizeventPayload(span, 'relevance', 'Relevance', makeEvalResult(), 'run-1', 'openai', 'gpt-4o', undefined, undefined, false);
      expect(payload['gen_ai.evaluation.input.question']).toBeUndefined();
      expect(payload['gen_ai.evaluation.input.answer']).toBeUndefined();
    });

    it('includes them when enabled', () => {
      const span = makeSpan({ systemInstruction: 'be helpful' });
      const payload = buildBizeventPayload(span, 'relevance', 'Relevance', makeEvalResult(), 'run-1', 'openai', 'gpt-4o', undefined, undefined, true);
      expect(payload['gen_ai.evaluation.input.question']).toBe(span.input);
      expect(payload['gen_ai.evaluation.input.answer']).toBe(span.output);
      expect(payload['gen_ai.evaluation.input.system_prompt']).toBe('be helpful');
    });
  });
});

describe('BizeventWriter', () => {
  it('calls client.ingestBizevents with the payload', async () => {
    const mockClient = {
      ingestBizevents: vi.fn().mockResolvedValue(undefined),
      executeDql: vi.fn(),
      ingestMetrics: vi.fn(),
    };

    const writer = new BizeventWriter(mockClient as unknown as import('../../src/dt/client.js').DynatraceClient);
    await writer.writeEvalResult(makeSpan(), 'toxicity', 'Toxicity', makeEvalResult(), 'run-001', 'openai', 'gpt-4o');

    expect(mockClient.ingestBizevents).toHaveBeenCalledOnce();
    const callArgs = mockClient.ingestBizevents.mock.calls[0]![0] as unknown[];
    expect(callArgs).toHaveLength(1);
    expect((callArgs[0] as Record<string, unknown>)['event.type']).toBe('gen_ai.evaluation.result');
  });

  it('writeBatch sends all payloads in one call', async () => {
    const mockClient = {
      ingestBizevents: vi.fn().mockResolvedValue(undefined),
      executeDql: vi.fn(),
      ingestMetrics: vi.fn(),
    };

    const writer = new BizeventWriter(mockClient as unknown as import('../../src/dt/client.js').DynatraceClient);

    const span1 = makeSpan({ traceId: 'trace-1' });
    const span2 = makeSpan({ traceId: 'trace-2' });

    const payloads = [
      buildBizeventPayload(span1, 'toxicity', 'Toxicity', makeEvalResult(), 'run-1', 'openai', 'gpt-4o'),
      buildBizeventPayload(span2, 'relevance', 'Relevance', makeEvalResult(), 'run-1', 'openai', 'gpt-4o'),
    ];

    await writer.writeBatch(payloads);

    expect(mockClient.ingestBizevents).toHaveBeenCalledOnce();
    const callArgs = mockClient.ingestBizevents.mock.calls[0]![0] as unknown[];
    expect(callArgs).toHaveLength(2);
  });

  it('writeBatch does nothing for empty array', async () => {
    const mockClient = {
      ingestBizevents: vi.fn().mockResolvedValue(undefined),
      executeDql: vi.fn(),
      ingestMetrics: vi.fn(),
    };
    const writer = new BizeventWriter(mockClient as unknown as import('../../src/dt/client.js').DynatraceClient);
    await writer.writeBatch([]);
    expect(mockClient.ingestBizevents).not.toHaveBeenCalled();
  });

  describe('judgeInputs override', () => {
    it('records the routed judge input over span.input when supplied', () => {
      const span = makeSpan({
        input: 'system: be nice\nuser: i am angry\nassistant: I understand',
        output: 'I understand',
        systemInstruction: 'be nice',
      });
      const payload = buildBizeventPayload(
        span,
        'user-frustration',
        'User Frustration',
        makeEvalResult(0, 'fail'),
        'run-1',
        'openai',
        'gpt-4o',
        'my-service',
        { input: 'i am angry', output: 'I understand', context: 'be nice' },
        true,
      );
      expect(payload['gen_ai.evaluation.input.question']).toBe('i am angry');
      expect(payload['gen_ai.evaluation.input.answer']).toBe('I understand');
      expect(payload['gen_ai.evaluation.input.system_prompt']).toBe('be nice');
    });

    it('falls back to span fields when judgeInputs is not supplied', () => {
      const span = makeSpan({ systemInstruction: 'be helpful' });
      const payload = buildBizeventPayload(
        span,
        'relevance',
        'Relevance',
        makeEvalResult(),
        'run-1',
        'openai',
        'gpt-4o',
        undefined,
        undefined,
        true,
      );
      expect(payload['gen_ai.evaluation.input.question']).toBe(span.input);
      expect(payload['gen_ai.evaluation.input.answer']).toBe(span.output);
      expect(payload['gen_ai.evaluation.input.system_prompt']).toBe('be helpful');
    });

    it('falls back to span fields per-slot when judgeInputs only overrides some slots', () => {
      const span = makeSpan();
      const payload = buildBizeventPayload(
        span,
        'user-frustration',
        'User Frustration',
        makeEvalResult(),
        'run-1',
        'openai',
        'gpt-4o',
        undefined,
        { input: 'just the user turn' }, // output / context not routed
        true,
      );
      expect(payload['gen_ai.evaluation.input.question']).toBe('just the user turn');
      expect(payload['gen_ai.evaluation.input.answer']).toBe(span.output);
    });
  });
});
