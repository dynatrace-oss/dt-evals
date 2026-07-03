/**
 * Condition DSL parser for `alerts.notifications[].condition`.
 *
 * Grammar:   <aggregation> <operator> <value>[%]
 * Examples:  "avg > 2", "count > 0", "fail_rate >= 10%", "max == 5"
 *
 * Translated to a DQL fragment that produces a single row named `agg` only when
 * the comparison holds — so the workflow task downstream just needs to check
 * whether any rows came back.
 */

export type Aggregation = 'avg' | 'max' | 'min' | 'count' | 'fail_rate';
export type Operator = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface ParsedCondition {
  aggregation: Aggregation;
  operator: Operator;
  value: number;
  /** True if the user wrote a percentage (e.g. "10%"); only meaningful for fail_rate. */
  isPercent: boolean;
  /** The original DSL string, for error messages and rendered descriptions. */
  raw: string;
}

const VALID_AGGS: Aggregation[] = ['avg', 'max', 'min', 'count', 'fail_rate'];
const VALID_OPS: Operator[] = ['>=', '<=', '==', '!=', '>', '<'];

const CONDITION_RE = /^\s*(avg|max|min|count|fail_rate)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*(%?)\s*$/i;

export class ConditionParseError extends Error {
  constructor(input: string, hint: string) {
    super(`Cannot parse condition "${input}": ${hint}`);
    this.name = 'ConditionParseError';
  }
}

export function parseCondition(input: string): ParsedCondition {
  const m = CONDITION_RE.exec(input);
  if (!m) {
    throw new ConditionParseError(
      input,
      `expected "<aggregation> <operator> <value>". ` +
      `aggregations: ${VALID_AGGS.join(' | ')}; operators: ${VALID_OPS.join(' | ')}`,
    );
  }
  const aggregation = m[1]!.toLowerCase() as Aggregation;
  const operator = m[2] as Operator;
  const value = Number(m[3]);
  const isPercent = m[4] === '%';
  if (Number.isNaN(value)) {
    throw new ConditionParseError(input, `value "${m[3]}" is not a number`);
  }
  if (isPercent && aggregation !== 'fail_rate') {
    throw new ConditionParseError(input, `% only applies to fail_rate (got ${aggregation})`);
  }
  if (aggregation === 'fail_rate' && !isPercent && (value > 1 || value < 0)) {
    throw new ConditionParseError(
      input,
      `fail_rate is a ratio between 0 and 1 — write "${value}%" for a percentage ` +
      `(e.g. "fail_rate > 10%" = 10% failing), or use a value like 0.1`,
    );
  }
  return { aggregation, operator, value, isPercent, raw: input.trim() };
}

/**
 * Build the DQL fragment that follows the `filter event.type == "..." | filter metric == "..."` prelude.
 * Returns a multi-line string ending with the filter that gates whether the alert fires.
 *
 * For `count`: counts rows where score.label == "fail".
 * For `fail_rate`: countIf(fail) / count(), normalised so `10%` and `0.1` both work.
 */
export function conditionToDql(c: ParsedCondition): string {
  const compareValue = c.aggregation === 'fail_rate' && c.isPercent ? c.value / 100 : c.value;

  switch (c.aggregation) {
    case 'avg':
    case 'max':
    case 'min': {
      const fn = c.aggregation;
      return [
        `| summarize agg = ${fn}(toDouble(gen_ai.evaluation.score.value))`,
        `| filter agg ${c.operator} ${compareValue}`,
      ].join('\n');
    }
    case 'count': {
      return [
        `| filter gen_ai.evaluation.score.label == "fail"`,
        `| summarize agg = count()`,
        `| filter agg ${c.operator} ${compareValue}`,
      ].join('\n');
    }
    case 'fail_rate': {
      return [
        `| summarize fail_count = countIf(gen_ai.evaluation.score.label == "fail"), total = count()`,
        `| fieldsAdd agg = if(total > 0, toDouble(fail_count) / toDouble(total), else: 0.0)`,
        `| filter agg ${c.operator} ${compareValue}`,
      ].join('\n');
    }
  }
}

/** Human-readable description for rendered messages: "avg toxicity > 2".
 *  fail_rate is always shown as a percentage so messages don't read "fail_rate > 0.1". */
export function describeCondition(c: ParsedCondition, metric: string): string {
  let valueStr: string;
  if (c.aggregation === 'fail_rate') {
    const pct = c.isPercent ? c.value : c.value * 100;
    valueStr = `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
  } else {
    valueStr = String(c.value);
  }
  return `${c.aggregation} ${metric} ${c.operator} ${valueStr}`;
}
