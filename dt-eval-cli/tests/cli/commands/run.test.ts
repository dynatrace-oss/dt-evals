import { describe, expect, it } from 'vitest';
import { buildEvaluationResultRows } from '../../../src/cli/commands/run.js';
import type { RunResult } from '../../../src/runner/index.js';

describe('buildEvaluationResultRows', () => {
  it('renders per-evaluator ratios instead of redistributed aggregate counts', () => {
    const result: RunResult = {
      runId: 'run-test',
      spansEvaluated: 1,
      resultsWritten: 1,
      errors: 1,
      errorSamples: ['relevance failed'],
      thresholdBreaches: [],
      durationMs: 1000,
      evaluatorResults: [
        { metric: 'toxicity', successes: 1, total: 1, errors: 0, avgDurationMs: 100 },
        { metric: 'relevance', successes: 0, total: 1, errors: 1, avgDurationMs: 200 },
      ],
    };

    expect(buildEvaluationResultRows(['toxicity', 'relevance'], result)).toEqual([
      ['toxicity', '1/1', '0/1', '100ms'],
      ['relevance', '0/1', '1/1', '200ms'],
    ]);
  });
});
