import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DtEvalConfig } from '../../src/config/schema.js';
import type { GenAiSpan } from '../../src/dt/types.js';

// Mock dt-eval-lib
vi.mock('@dynatrace-oss/dt-eval-lib', () => ({
  evaluate: vi.fn().mockResolvedValue({
    score: { value: 0.9, label: 'pass' },
    explanation: { summary: 'Looks good', reasoning: 'No issues' },
  }),
  getPrompt: vi.fn((id: string) => ({
    id,
    name: id,
    version: '1',
    description: '',
    prompt: '',
    requiredFields: ['input', 'output'],
    scoring: { type: 'continuous', range: [0, 1], threshold: 0.7 },
  })),
  DRIFT_METRIC_ID: 'drift',
}));

// Mock appendRunRecord from checkpoint to avoid filesystem writes
vi.mock('../../src/runner/checkpoint.js', () => ({
  appendRunRecord: vi.fn().mockResolvedValue(undefined),
}));

function makeSpan(overrides?: Partial<GenAiSpan>): GenAiSpan {
  return {
    traceId: `trace-${Math.random().toString(36).slice(2, 8)}`,
    spanId: 'span-001',
    timestamp: new Date().toISOString(),
    input: 'What is the capital of France?',
    output: 'Paris is the capital of France.',
    system: 'openai',
    requestModel: 'gpt-4o',
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<DtEvalConfig>): DtEvalConfig {
  return {
    schemaVersion: 1,
    dynatrace: {
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'test-token',
    },
    judge: {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      timeout: 30000,
      maxRetries: 2,
    },
    scope: {
      since: '1h',
      sampling: { strategy: 'random', percent: 100 },
    },
    metrics: {
      enabled: ['toxicity', 'relevance'],
    },
    ...overrides,
  };
}

function makeDtClient(spans: GenAiSpan[]) {
  const records = spans.map(s => ({
    'trace.id': s.traceId,
    'span.id': s.spanId,
    timestamp: s.timestamp,
    'gen_ai.input.messages': s.input,
    'gen_ai.output.message': s.output,
    'gen_ai.system': s.system,
    'gen_ai.request.model': s.requestModel,
    'gen_ai.system_instruction': s.systemInstruction,
    // Include a user-role prompt slot so the parser surfaces userPrompt
    // for tests that rely on per-metric inputs routing.
    ...(s.userPrompt
      ? { 'gen_ai.prompt.0.role': 'user', 'gen_ai.prompt.0.content': s.userPrompt }
      : {}),
  }));
  return {
    executeDql: vi.fn().mockResolvedValue(records),
    ingestBizevents: vi.fn().mockResolvedValue(undefined),
    ingestMetrics: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runEvals', () => {
  let runEvals: typeof import('../../src/runner/index.js').runEvals;
  let evaluate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../src/runner/index.js');
    runEvals = mod.runEvals;
    const dtEvalLib = await import('@dynatrace-oss/dt-eval-lib');
    evaluate = dtEvalLib.evaluate as ReturnType<typeof vi.fn>;
  });

  it('fetches spans and evaluates them', async () => {
    const spans = [makeSpan({ traceId: 'trace-001' }), makeSpan({ traceId: 'trace-002' })];
    const dtClient = makeDtClient(spans);
    const config = makeConfig();

    const result = await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    expect(dtClient.executeDql).toHaveBeenCalledOnce();
    expect(result.spansEvaluated).toBe(2);
    // 2 spans × 2 metrics = 4 evaluations
    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(result.resultsWritten).toBe(4);
  });

  it('applies sampling (sample=50 takes ~half)', async () => {
    const spans = Array.from({ length: 20 }, (_, i) => makeSpan({ traceId: `trace-${i}` }));
    const dtClient = makeDtClient(spans);
    const config = makeConfig();

    const result = await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h', sample: 50 },
    );

    // With 50% sampling of 20 spans, should get ~10
    expect(result.spansEvaluated).toBeLessThanOrEqual(15);
    expect(result.spansEvaluated).toBeGreaterThanOrEqual(5);
  });

  it('applies PII masking before eval', async () => {
    const spanWithPii = makeSpan({
      traceId: 'trace-pii',
      input: 'My email is user@example.com, help me',
      output: 'Call me at 555-123-4567',
    });
    const dtClient = makeDtClient([spanWithPii]);
    const config = makeConfig({ metrics: { enabled: ['toxicity'] } });

    await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    expect(evaluate).toHaveBeenCalledOnce();
    const callArgs = evaluate.mock.calls[0] as unknown[];
    const evalInput = callArgs[1] as { input: string; output: string };
    expect(evalInput.input).not.toContain('user@example.com');
    expect(evalInput.output).not.toContain('555-123-4567');
    expect(evalInput.input).toContain('[REDACTED]');
    expect(evalInput.output).toContain('[REDACTED]');
  });

  it('writes bizevents for each span×metric', async () => {
    const spans = [makeSpan(), makeSpan()];
    const dtClient = makeDtClient(spans);
    const config = makeConfig({ metrics: { enabled: ['toxicity', 'relevance', 'faithfulness'] } });

    await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    // 2 spans × 3 metrics = 6 results, all written in one batch
    expect(dtClient.ingestBizevents).toHaveBeenCalledOnce();
    const [payloads] = dtClient.ingestBizevents.mock.calls[0] as [unknown[]];
    expect(payloads).toHaveLength(6);
  });

  it('dry-run returns correct counts without writing bizevents', async () => {
    const spans = [makeSpan(), makeSpan(), makeSpan()];
    const dtClient = makeDtClient(spans);
    const config = makeConfig();

    const result = await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h', dryRun: true },
    );

    expect(result.spansEvaluated).toBe(3);
    expect(result.resultsWritten).toBe(0);
    expect(dtClient.ingestBizevents).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('threshold breach detected when score below threshold', async () => {
    evaluate.mockResolvedValue({
      score: { value: 0.3, label: 'fail' },
      explanation: { summary: 'Poor quality' },
    });

    const spans = [makeSpan({ traceId: 'trace-breach' })];
    const dtClient = makeDtClient(spans);
    const config = makeConfig({
      metrics: { enabled: ['toxicity'] },
      alerts: { thresholds: { toxicity: 0.5 } },
    });

    const result = await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    expect(result.thresholdBreaches).toHaveLength(1);
    expect(result.thresholdBreaches[0]!.metric).toBe('toxicity');
    expect(result.thresholdBreaches[0]!.score).toBe(0.3);
  });

  it('errors in individual evals do not stop the batch', async () => {
    let callCount = 0;
    evaluate.mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) {
        return Promise.reject(new Error('eval failed'));
      }
      return Promise.resolve({
        score: { value: 0.9, label: 'pass' },
        explanation: { summary: 'Good' },
      });
    });

    const spans = Array.from({ length: 4 }, (_, i) => makeSpan({ traceId: `trace-${i}` }));
    const dtClient = makeDtClient(spans);
    const config = makeConfig({ metrics: { enabled: ['toxicity'] } });

    const result = await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    // 4 evals, 2 succeed, 2 fail
    expect(result.errors).toBe(2);
    expect(result.resultsWritten).toBe(2);
  });

  it('ci mode logs breaches', async () => {
    evaluate.mockResolvedValue({
      score: { value: 0.2, label: 'fail' },
      explanation: { summary: 'Bad' },
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const spans = [makeSpan({ traceId: 'trace-ci' })];
    const dtClient = makeDtClient(spans);
    const config = makeConfig({
      metrics: { enabled: ['toxicity'] },
      alerts: { thresholds: { toxicity: 0.5 } },
    });

    await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h', ci: true },
    );

    // ci mode should output JSON result
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('empty span set returns zero results', async () => {
    const dtClient = makeDtClient([]);
    const config = makeConfig();

    const result = await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    expect(result.spansEvaluated).toBe(0);
    expect(result.resultsWritten).toBe(0);
    expect(result.errors).toBe(0);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('per-metric inputs.input=userPrompt routes the user-role prompt into the eval input', async () => {
    const span = makeSpan({
      traceId: 'trace-uf',
      input: 'system: be nice\nuser: i am angry\nassistant: I understand',
      output: 'I understand',
      userPrompt: 'i am angry',
    });
    const dtClient = makeDtClient([span]);
    const config = makeConfig({
      metrics: {
        enabled: [{ id: 'user-frustration', inputs: { input: 'userPrompt' } }],
      },
    });

    await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    expect(evaluate).toHaveBeenCalledOnce();
    const callArgs = evaluate.mock.calls[0] as unknown[];
    expect((callArgs[0] as { id: string }).id).toBe('user-frustration');
    const evalInput = callArgs[1] as { input: string };
    expect(evalInput.input).toBe('i am angry');
  });

  it('mixed string and object metric entries both run', async () => {
    const span = makeSpan({ userPrompt: 'just the user turn' });
    const dtClient = makeDtClient([span]);
    const config = makeConfig({
      metrics: {
        enabled: [
          'toxicity',
          { id: 'user-frustration', inputs: { input: 'userPrompt' } },
        ],
      },
    });

    await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    expect(evaluate).toHaveBeenCalledTimes(2);
    const calls = evaluate.mock.calls as unknown[][];
    const byMetric: Record<string, { input: string }> = {};
    for (const c of calls) {
      byMetric[(c[0] as { id: string }).id] = c[1] as { input: string };
    }
    expect(byMetric['toxicity']!.input).toBe(span.input);
    expect(byMetric['user-frustration']!.input).toBe('just the user turn');
  });

  it('falls back to span.input when the requested canonical field is unset on the span', async () => {
    // span has no userPrompt — runner must not pass undefined to evaluate
    const span = makeSpan({ userPrompt: undefined });
    const dtClient = makeDtClient([span]);
    const config = makeConfig({
      metrics: {
        enabled: [{ id: 'user-frustration', inputs: { input: 'userPrompt' } }],
      },
    });

    await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    const callArgs = evaluate.mock.calls[0] as unknown[];
    const evalInput = callArgs[1] as { input: string };
    expect(evalInput.input).toBe(span.input);
  });
});
