import { describe, expect, it } from 'vitest';
import { buildEvaluationResultRows } from '../../../src/cli/commands/run.js';
import type { RunResult } from '../../../src/runner/index.js';

describe('buildEvaluationResultRows', () => {
  it('renders per-evaluator pass ratios with a pass percentage', () => {
    const result: RunResult = {
      runId: 'run-test',
      spansEvaluated: 1,
      resultsWritten: 1,
      errors: 1,
      errorSamples: ['relevance failed'],
      thresholdBreaches: [],
      durationMs: 1000,
      evaluatorResults: [
        { metric: 'toxicity', successes: 1, passes: 1, total: 1, errors: 0, avgDurationMs: 100 },
        { metric: 'relevance', successes: 0, passes: 0, total: 1, errors: 1, avgDurationMs: 200 },
      ],
    };

    expect(buildEvaluationResultRows(['toxicity', 'relevance', 'completeness'], result)).toEqual([
      ['toxicity', '1/1 (100% passed)', '100ms'],
      ['relevance', '0/1 (0% passed), 1 error', '200ms'],
      ['completeness', '0/0 (0% passed)', '0ms'],
    ]);
  });

  it('reports the real pass rate for a mixed run, not the completion rate', () => {
    // 5 evaluations all completed successfully, but only 4 of the 5 scored 'pass'.
    const result: RunResult = {
      runId: 'run-test',
      spansEvaluated: 5,
      resultsWritten: 5,
      errors: 0,
      errorSamples: [],
      thresholdBreaches: [],
      durationMs: 1000,
      evaluatorResults: [
        { metric: 'routing-accuracy', successes: 5, passes: 4, total: 5, errors: 0, avgDurationMs: 2600 },
      ],
    };

    expect(buildEvaluationResultRows(['routing-accuracy'], result)).toEqual([
      ['routing-accuracy', '4/5 (80% passed)', '2.6s'],
    ]);
  });

  it('renders 100% passed when every evaluation passes', () => {
    const result: RunResult = {
      runId: 'run-test',
      spansEvaluated: 5,
      resultsWritten: 5,
      errors: 0,
      errorSamples: [],
      thresholdBreaches: [],
      durationMs: 1000,
      evaluatorResults: [
        { metric: 'routing-accuracy', successes: 5, passes: 5, total: 5, errors: 0, avgDurationMs: 100 },
      ],
    };

    expect(buildEvaluationResultRows(['routing-accuracy'], result)).toEqual([
      ['routing-accuracy', '5/5 (100% passed)', '100ms'],
    ]);
  });

  it('renders 0% passed when every evaluation fails (but completed)', () => {
    const result: RunResult = {
      runId: 'run-test',
      spansEvaluated: 5,
      resultsWritten: 5,
      errors: 0,
      errorSamples: [],
      thresholdBreaches: [],
      durationMs: 1000,
      evaluatorResults: [
        { metric: 'routing-accuracy', successes: 5, passes: 0, total: 5, errors: 0, avgDurationMs: 100 },
      ],
    };

    expect(buildEvaluationResultRows(['routing-accuracy'], result)).toEqual([
      ['routing-accuracy', '0/5 (0% passed)', '100ms'],
    ]);
  });

  it('surfaces errors instead of hiding them behind the pass rate', () => {
    // Every judge call threw: 0 passes out of 5, but that should read as
    // "nothing ran" (errors visible), not "the model failed everything".
    const result: RunResult = {
      runId: 'run-test',
      spansEvaluated: 5,
      resultsWritten: 0,
      errors: 5,
      errorSamples: ['judge timeout'],
      thresholdBreaches: [],
      durationMs: 1000,
      evaluatorResults: [
        { metric: 'routing-accuracy', successes: 0, passes: 0, total: 5, errors: 5, avgDurationMs: 0 },
      ],
    };

    expect(buildEvaluationResultRows(['routing-accuracy'], result)).toEqual([
      ['routing-accuracy', '0/5 (0% passed), 5 errors', '0ms'],
    ]);
  });

  it('does not divide by zero when total is 0', () => {
    const result: RunResult = {
      runId: 'run-test',
      spansEvaluated: 0,
      resultsWritten: 0,
      errors: 0,
      errorSamples: [],
      thresholdBreaches: [],
      durationMs: 0,
      evaluatorResults: [],
    };

    expect(buildEvaluationResultRows(['routing-accuracy'], result)).toEqual([
      ['routing-accuracy', '0/0 (0% passed)', '0ms'],
    ]);
  });
});
