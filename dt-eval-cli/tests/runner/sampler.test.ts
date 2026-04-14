import { describe, it, expect } from 'vitest';
import { applySampling } from '../../src/runner/sampler.js';
import type { GenAiSpan } from '../../src/dt/types.js';
import type { ScopeConfig } from '../../src/config/schema.js';

function makeSpan(traceId: string, overrides?: Partial<GenAiSpan>): GenAiSpan {
  return {
    traceId,
    timestamp: new Date().toISOString(),
    input: 'test input',
    output: 'test output',
    ...overrides,
  };
}

function makeScope(overrides: Partial<ScopeConfig> = {}): ScopeConfig {
  return {
    since: '1h',
    sampling: { strategy: 'random', percent: 100 },
    ...overrides,
  };
}

function makeSpans(count: number, errorIndices: number[] = []): GenAiSpan[] {
  return Array.from({ length: count }, (_, i) => {
    const isError = errorIndices.includes(i);
    const ts = new Date(Date.now() - i * 60_000).toISOString();
    return makeSpan(`trace-${i}`, { timestamp: ts, isError: isError || undefined });
  });
}

describe('applySampling — random strategy', () => {
  it('returns all spans when percent is 100', () => {
    const spans = makeSpans(10);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'random', percent: 100 } }));
    expect(result).toHaveLength(10);
  });

  it('returns correct percentage of spans', () => {
    const spans = makeSpans(100);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'random', percent: 50 } }));
    expect(result).toHaveLength(50);
  });

  it('returns correct percentage (10%)', () => {
    const spans = makeSpans(100);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'random', percent: 10 } }));
    expect(result).toHaveLength(10);
  });

  it('never returns more than input size', () => {
    const spans = makeSpans(5);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'random', percent: 100 } }));
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('returns empty for 0% sample', () => {
    const spans = makeSpans(10);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'random', percent: 0 } }));
    expect(result).toHaveLength(0);
  });

  it('returns all spans when percent is omitted (defaults to 100)', () => {
    const spans = makeSpans(5);
    const scope = makeScope({ sampling: { strategy: 'random' } });
    const result = applySampling(spans, scope);
    expect(result).toHaveLength(5);
  });
});

describe('applySampling — latest strategy', () => {
  it('returns most recent N spans', () => {
    const spans = makeSpans(10); // span 0 is most recent (timestamp = now), span 9 is oldest
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'latest', count: 3 } }));
    expect(result).toHaveLength(3);
    // First result should have the most recent timestamp
    const timestamps = result.map(s => new Date(s.timestamp).getTime());
    const maxTimestamp = Math.max(...spans.map(s => new Date(s.timestamp).getTime()));
    expect(timestamps[0]).toBe(maxTimestamp);
  });

  it('returns all spans when count exceeds span count', () => {
    const spans = makeSpans(5);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'latest', count: 100 } }));
    expect(result).toHaveLength(5);
  });

  it('returns spans sorted by timestamp descending', () => {
    const spans = makeSpans(5);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'latest', count: 5 } }));
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1]!.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(result[i]!.timestamp).getTime(),
      );
    }
  });

  it('returns all spans when count is not specified', () => {
    const spans = makeSpans(5);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'latest' } }));
    expect(result).toHaveLength(5);
  });
});

describe('applySampling — errors-only strategy', () => {
  it('returns only error spans', () => {
    const spans = makeSpans(10, [2, 5, 7]); // error at indices 2, 5, 7
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'errors-only' } }));
    expect(result).toHaveLength(3);
    expect(result.every(s => s.isError === true)).toBe(true);
  });

  it('returns empty array when there are no error spans', () => {
    const spans = makeSpans(10);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'errors-only' } }));
    expect(result).toHaveLength(0);
  });

  it('returns all spans if all are errors', () => {
    const spans = makeSpans(5, [0, 1, 2, 3, 4]);
    const result = applySampling(spans, makeScope({ sampling: { strategy: 'errors-only' } }));
    expect(result).toHaveLength(5);
  });
});

describe('applySampling — edge cases', () => {
  it('handles empty input for all strategies', () => {
    const strategies: Array<ScopeConfig['sampling']['strategy']> = ['random', 'latest', 'errors-only'];
    for (const strategy of strategies) {
      const result = applySampling([], makeScope({ sampling: { strategy } }));
      expect(result).toHaveLength(0);
    }
  });
});
