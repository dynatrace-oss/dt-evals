import { describe, expect, it } from 'vitest';
import { parseCondition, conditionToDql, ConditionParseError, describeCondition } from '../../src/alerts/condition.js';

describe('parseCondition', () => {
  it('parses simple aggregation comparisons', () => {
    expect(parseCondition('avg > 2')).toMatchObject({ aggregation: 'avg', operator: '>', value: 2, isPercent: false });
    expect(parseCondition('count >= 5')).toMatchObject({ aggregation: 'count', operator: '>=', value: 5 });
    expect(parseCondition('max == 4')).toMatchObject({ aggregation: 'max', operator: '==', value: 4 });
    expect(parseCondition('min < 0.5')).toMatchObject({ aggregation: 'min', operator: '<', value: 0.5 });
  });

  it('accepts %% only for fail_rate', () => {
    expect(parseCondition('fail_rate > 10%')).toMatchObject({ aggregation: 'fail_rate', value: 10, isPercent: true });
    expect(parseCondition('fail_rate > 0.1')).toMatchObject({ aggregation: 'fail_rate', value: 0.1, isPercent: false });
    expect(() => parseCondition('avg > 10%')).toThrow(ConditionParseError);
  });

  it('rejects unknown aggregations and operators', () => {
    expect(() => parseCondition('foobar > 1')).toThrow(ConditionParseError);
    expect(() => parseCondition('avg ~ 1')).toThrow(ConditionParseError);
    expect(() => parseCondition('not a condition')).toThrow(ConditionParseError);
  });

  it('is case-insensitive on aggregation name', () => {
    expect(parseCondition('AVG > 2').aggregation).toBe('avg');
  });
});

describe('conditionToDql', () => {
  it('renders avg/max/min as summarize + filter', () => {
    const dql = conditionToDql(parseCondition('avg > 2'));
    expect(dql).toContain('avg(toDouble(gen_ai.evaluation.score.value))');
    expect(dql).toContain('filter agg > 2');
  });

  it('renders count as countIf-on-fail + filter', () => {
    const dql = conditionToDql(parseCondition('count > 0'));
    expect(dql).toContain('score.label == "fail"');
    expect(dql).toContain('summarize agg = count()');
    expect(dql).toContain('filter agg > 0');
  });

  it('normalises percent fail_rate to a 0..1 comparison', () => {
    const dql = conditionToDql(parseCondition('fail_rate > 10%'));
    expect(dql).toContain('countIf(gen_ai.evaluation.score.label == "fail")');
    expect(dql).toContain('filter agg > 0.1');
  });

  it('leaves bare fail_rate value alone', () => {
    const dql = conditionToDql(parseCondition('fail_rate >= 0.25'));
    expect(dql).toContain('filter agg >= 0.25');
  });
});

describe('describeCondition', () => {
  it('formats with the metric name', () => {
    expect(describeCondition(parseCondition('avg > 2'), 'toxicity')).toBe('avg toxicity > 2');
    expect(describeCondition(parseCondition('fail_rate > 10%'), 'relevance')).toBe('fail_rate relevance > 10%');
  });

  it('always renders fail_rate as a percentage, even when the YAML used a ratio', () => {
    expect(describeCondition(parseCondition('fail_rate > 0.1'), 'relevance')).toBe('fail_rate relevance > 10%');
    expect(describeCondition(parseCondition('fail_rate >= 0.25'), 'relevance')).toBe('fail_rate relevance >= 25%');
  });
});

describe('parseCondition: fail_rate ambiguity guard', () => {
  it('rejects bare fail_rate values that look like percentages without %%', () => {
    expect(() => parseCondition('fail_rate > 10')).toThrow(/ratio between 0 and 1/);
    expect(() => parseCondition('fail_rate > 50')).toThrow(/ratio between 0 and 1/);
  });

  it('accepts fail_rate values inside [0, 1] without %%', () => {
    expect(() => parseCondition('fail_rate > 0.1')).not.toThrow();
    expect(() => parseCondition('fail_rate >= 1')).not.toThrow();
  });
});
