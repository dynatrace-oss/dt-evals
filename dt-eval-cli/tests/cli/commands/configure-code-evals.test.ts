import { describe, it, expect } from 'vitest';
import {
  collectCodeEvalParams,
  authorCodeEval,
  collectCodeEvals,
  CODE_EVAL_DONE,
  type CodeCheckMethod,
  type CodeEvalEntry,
} from '../../../src/cli/commands/configure.js';

// The interactive helpers take an injected `@inquirer/prompts`-shaped object so
// they can be driven without a TTY. `scriptedInq` replays a fixed queue of
// answers across the input/select/confirm prompts, in call order. When a
// prompt has a `validate` fn, the mock runs it and — like the real inquirer —
// skips (re-prompts) on failure, recording the rejection for assertions.

interface Rejection {
  message: string;
  value: string | boolean;
  reason: string | boolean;
}

function scriptedInq(script: Array<string | boolean>): {
  inq: typeof import('@inquirer/prompts');
  rejections: Rejection[];
  remaining: () => number;
} {
  const queue = [...script];
  const rejections: Rejection[] = [];

  const take = (cfg: { message?: string; validate?: (v: string) => true | string }) => {
    for (;;) {
      if (queue.length === 0) {
        throw new Error(`scriptedInq: no answer left for prompt "${cfg.message}"`);
      }
      const value = queue.shift() as string | boolean;
      if (cfg.validate) {
        const result = cfg.validate(String(value));
        if (result !== true) {
          rejections.push({ message: cfg.message ?? '', value, reason: result });
          continue; // real inquirer re-prompts; pull the next scripted answer
        }
      }
      return value;
    }
  };

  const inq = {
    input: async (cfg: never) => take(cfg) as string,
    select: async (cfg: never) => take(cfg),
    confirm: async (cfg: never) => take(cfg) as boolean,
  } as unknown as typeof import('@inquirer/prompts');

  return { inq, rejections, remaining: () => queue.length };
}

describe('collectCodeEvalParams', () => {
  it('must_contain: splits/trims keywords and captures mode + caseSensitive', async () => {
    const { inq } = scriptedInq([' song, music , track ', 'all', true]);
    const params = await collectCodeEvalParams('must_contain', inq);
    expect(params).toEqual({ keywords: ['song', 'music', 'track'], mode: 'all', caseSensitive: true });
  });

  it('must_not_contain: same param shape (direction is applied by the engine)', async () => {
    const { inq } = scriptedInq(['spam,ads', 'any', false]);
    const params = await collectCodeEvalParams('must_not_contain', inq);
    expect(params).toEqual({ keywords: ['spam', 'ads'], mode: 'any', caseSensitive: false });
  });

  it('must_contain: rejects an all-blank keyword list, then accepts a valid one', async () => {
    const { inq, rejections } = scriptedInq(['   ,  ,', 'real-keyword', 'any', false]);
    const params = await collectCodeEvalParams('must_contain', inq);
    expect(params).toEqual({ keywords: ['real-keyword'], mode: 'any', caseSensitive: false });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toMatch(/at least one keyword/i);
  });

  it('exact_match: captures expectedOutput + caseSensitive + trim', async () => {
    const { inq } = scriptedInq(['the answer', false, true]);
    const params = await collectCodeEvalParams('exact_match', inq);
    expect(params).toEqual({ expectedOutput: 'the answer', caseSensitive: false, trim: true });
  });

  it('exact_match: rejects empty expected output', async () => {
    const { inq, rejections } = scriptedInq(['', 'now-non-empty', true, true]);
    const params = await collectCodeEvalParams('exact_match', inq);
    expect(params).toEqual({ expectedOutput: 'now-non-empty', caseSensitive: true, trim: true });
    expect(rejections[0]?.reason).toMatch(/required/i);
  });

  it('regex: includes flags only when non-empty', async () => {
    const withFlags = scriptedInq(['[A-Z]{3,}', 'i']);
    expect(await collectCodeEvalParams('regex', withFlags.inq)).toEqual({ pattern: '[A-Z]{3,}', flags: 'i' });

    const noFlags = scriptedInq(['[A-Z]{3,}', '   ']);
    expect(await collectCodeEvalParams('regex', noFlags.inq)).toEqual({ pattern: '[A-Z]{3,}' });
  });

  it('must_not_match: shares the regex param shape', async () => {
    const { inq } = scriptedInq(['\\d{3}-\\d{4}', '']);
    expect(await collectCodeEvalParams('must_not_match', inq)).toEqual({ pattern: '\\d{3}-\\d{4}' });
  });

  it('json_schema: parses the entered JSON object', async () => {
    const { inq } = scriptedInq(['{"type":"object","required":["id"]}']);
    expect(await collectCodeEvalParams('json_schema', inq)).toEqual({
      schema: { type: 'object', required: ['id'] },
    });
  });

  it('json_schema: rejects invalid JSON and non-object JSON', async () => {
    const { inq, rejections } = scriptedInq(['not json', '[1,2,3]', '{"type":"object"}']);
    const params = await collectCodeEvalParams('json_schema', inq);
    expect(params).toEqual({ schema: { type: 'object' } });
    expect(rejections).toHaveLength(2); // invalid JSON, then a JSON array
  });
});

describe('authorCodeEval', () => {
  it('builds a full entry and omits inputs when target is output (default)', async () => {
    const { inq } = scriptedInq(['keyword-check', 'hello', 'any', false, 'output']);
    const entry = await authorCodeEval('must_contain', inq, []);
    expect(entry).toEqual({
      id: 'keyword-check',
      method: 'must_contain',
      params: { keywords: ['hello'], mode: 'any', caseSensitive: false },
    });
    expect(entry?.inputs).toBeUndefined();
  });

  it('routes a non-output target via inputs.output', async () => {
    const { inq } = scriptedInq(['pii-check', '\\d{3}', '', 'input']);
    const entry = await authorCodeEval('must_not_match', inq, []);
    expect(entry).toEqual({
      id: 'pii-check',
      method: 'must_not_match',
      params: { pattern: '\\d{3}' },
      inputs: { output: 'input' },
    });
  });

  it('returns null (go back) when the id is left blank — no further prompts consumed', async () => {
    const { inq, remaining } = scriptedInq(['', 'unused-1', 'unused-2']);
    const entry = await authorCodeEval('exact_match', inq, []);
    expect(entry).toBeNull();
    expect(remaining()).toBe(2); // params/target prompts were never reached
  });

  it('rejects a duplicate id, then accepts a fresh one', async () => {
    const existing: CodeEvalEntry[] = [{ id: 'taken', method: 'regex', params: { pattern: 'x' } }];
    const { inq, rejections } = scriptedInq(['taken', 'fresh', '{"type":"object"}', 'output']);
    const entry = await authorCodeEval('json_schema', inq, existing);
    expect(entry?.id).toBe('fresh');
    expect(rejections[0]?.reason).toMatch(/already exists/i);
  });

  it('trims the entered id', async () => {
    const { inq } = scriptedInq(['  spaced-id  ', 'k', 'any', false, 'output']);
    const entry = await authorCodeEval('must_contain', inq, []);
    expect(entry?.id).toBe('spaced-id');
  });
});

describe('collectCodeEvals', () => {
  it('returns [] when the user skips immediately', async () => {
    const { inq } = scriptedInq([CODE_EVAL_DONE]);
    expect(await collectCodeEvals(inq)).toEqual([]);
  });

  it('collects multiple entries across methods until done', async () => {
    const { inq } = scriptedInq([
      // 1st: must_contain
      'must_contain', 'has-music', 'song,track', 'any', false, 'output',
      // 2nd: regex on input
      'regex', 'looks-like-code', '[a-z]+', '', 'input',
      // finish
      CODE_EVAL_DONE,
    ]);
    const evals = await collectCodeEvals(inq);
    expect(evals).toHaveLength(2);
    expect(evals[0]).toEqual({
      id: 'has-music',
      method: 'must_contain',
      params: { keywords: ['song', 'track'], mode: 'any', caseSensitive: false },
    });
    expect(evals[1]).toEqual({
      id: 'looks-like-code',
      method: 'regex',
      params: { pattern: '[a-z]+' },
      inputs: { output: 'input' },
    });
  });

  it('a blank id mid-flow discards that check and returns to the menu (back)', async () => {
    const { inq } = scriptedInq([
      'exact_match', '', // start authoring, then go back (blank id)
      'must_contain', 'kept', 'yes', 'any', false, 'output', // author a real one
      CODE_EVAL_DONE,
    ]);
    const evals = await collectCodeEvals(inq);
    expect(evals).toHaveLength(1);
    expect(evals[0]?.id).toBe('kept');
  });

  it('collected entries are treated as existing for de-duplication of later ids', async () => {
    const { inq, rejections } = scriptedInq([
      'must_contain', 'dup', 'a', 'any', false, 'output',
      'must_contain', 'dup', 'unique', 'b', 'any', false, 'output', // 'dup' rejected → 'unique'
      CODE_EVAL_DONE,
    ]);
    const evals = await collectCodeEvals(inq);
    expect(evals.map((e) => e.id)).toEqual(['dup', 'unique']);
    expect(rejections.some((r) => /already exists/i.test(String(r.reason)))).toBe(true);
  });
});

// Guards against a method being added to CodeCheckMethod without a params-collector
// branch (the switch would fall through and return undefined).
describe('coverage of all methods', () => {
  const perMethodScript: Record<CodeCheckMethod, Array<string | boolean>> = {
    must_contain: ['k', 'any', false],
    must_not_contain: ['k', 'any', false],
    exact_match: ['v', true, true],
    regex: ['p', ''],
    must_not_match: ['p', ''],
    json_schema: ['{"type":"object"}'],
  };

  for (const method of Object.keys(perMethodScript) as CodeCheckMethod[]) {
    it(`${method} yields a defined params object`, async () => {
      const { inq } = scriptedInq(perMethodScript[method]);
      const params = await collectCodeEvalParams(method, inq);
      expect(params).toBeTypeOf('object');
      expect(params).not.toBeNull();
    });
  }
});
