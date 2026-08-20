import { describe, expect, it, vi } from 'vitest';
import type { DtEvalConfig } from '../../src/config/schema.js';

vi.mock('@dynatrace-oss/dt-eval-lib', async () =>
  import('../../../dt-eval-lib/src/index.ts'));

describe('deterministic evaluator integration', () => {
  it('runs exact_match through the real library implementation', async () => {
    const { runEvals } = await import('../../src/runner/index.js');
    const dtClient = {
      executeDql: vi.fn().mockResolvedValue([{
        'trace.id': 'trace-exact-match',
        'span.id': 'span-exact-match',
        'gen_ai.operation.name': 'chat',
        'gen_ai.input.messages': 'question',
        'gen_ai.output.messages': 'expected answer',
        'reference.answer': 'expected answer',
      }]),
      ingestBizevents: vi.fn().mockResolvedValue(undefined),
      ingestMetrics: vi.fn().mockResolvedValue(undefined),
    };
    const config: DtEvalConfig = {
      schemaVersion: 3,
      dynatrace: { environmentUrl: 'https://example.live.dynatrace.com' },
      judge: { provider: 'openai' },
      scope: {
        since: '1h',
        spanFields: { context: 'reference.answer' },
        sampling: { strategy: 'random', percent: 100 },
      },
      metrics: {
        enabled: [{
          id: 'answer-match',
          method: 'exact_match',
          inputs: { expectedOutput: 'context' },
        }],
      },
    };

    const result = await runEvals(
      dtClient as unknown as import('../../src/dt/client.js').DynatraceClient,
      config,
      { since: '1h' },
    );

    expect(result.errors).toBe(0);
    expect(result.resultsWritten).toBe(1);
    const [payloads] = dtClient.ingestBizevents.mock.calls[0] as [Record<string, unknown>[]];
    expect(payloads[0]).toMatchObject({
      'gen_ai.evaluation.method': 'exact_match',
      'gen_ai.evaluation.score.value': 1,
      'gen_ai.evaluation.score.label': 'pass',
    });
  });
});
