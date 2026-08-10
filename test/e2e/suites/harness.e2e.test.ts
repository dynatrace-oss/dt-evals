/**
 * Unit tests for the harness's own logic.
 *
 * Everything here is a pure function, needs no tenant and no judge, and runs in
 * the credential-free PR lane. That is the point: these are the mechanisms every
 * other suite's trustworthiness rests on, and until now none of them was
 * exercised by anything.
 *
 * The most important of them is the skip-vs-fail gate. `src/env.ts` records that
 * an earlier version guarded only the tenant variables, which let a CI run with
 * `E2E_REQUIRE_ENV=1` skip the `validate` and `run` suites — half the suite — and
 * still report green. A regression there does not fail loudly; it turns the whole
 * suite into a no-op that reports success. Nothing else in the suite can catch that.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  assertOutputLacks,
  assertNoSecrets,
  parseJsonStdout,
  redactSecrets,
} from '../src/assert.js';
import type { CliResult } from '../src/cli.js';
import { reportMissingCredentials, requireEnv } from '../src/env.js';

/**
 * Set env vars for one test and restore them afterwards.
 *
 * Safe only because `vitest.config.ts` pins `maxConcurrency: 1` and
 * `sequence.concurrent: false` — those settings are load-bearing for correctness
 * here, not just for tenant rate limits.
 */
const saved = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined): void {
  if (!saved.has(key)) saved.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

/** A CliResult with only the fields the assertion under test reads. */
function cliResult(overrides: Partial<CliResult> = {}): CliResult {
  const stdout = overrides.stdout ?? '';
  const stderr = overrides.stderr ?? '';
  return {
    exitCode: 0,
    stdout,
    stderr,
    output: overrides.output ?? stdout + stderr,
    args: ['run'],
    homeFiles: {},
    ...overrides,
  };
}

describe('requireEnv — the skip-vs-fail switch', () => {
  it('is off when unset, so a local run without credentials skips', () => {
    setEnv('E2E_REQUIRE_ENV', undefined);
    expect(requireEnv()).toBe(false);
  });

  it.each(['0', 'false', 'no', 'FALSE', 'No'])('treats %s as explicitly off', (value) => {
    // Reading these as "on" merely because the variable is non-empty is the
    // sharp edge that gets a pipeline stuck for an afternoon.
    setEnv('E2E_REQUIRE_ENV', value);
    expect(requireEnv()).toBe(false);
  });

  it.each(['1', 'true', 'yes'])('treats %s as on', (value) => {
    setEnv('E2E_REQUIRE_ENV', value);
    expect(requireEnv()).toBe(true);
  });
});

describe('reportMissingCredentials — one place decides skip vs fail', () => {
  it('throws under E2E_REQUIRE_ENV, naming the missing variables', () => {
    setEnv('E2E_REQUIRE_ENV', '1');
    expect(() => reportMissingCredentials('bedrock judge', ['AWS_ACCESS_KEY_ID'])).toThrow(
      /AWS_ACCESS_KEY_ID/,
    );
  });

  it('says why it is a failure rather than a skip', () => {
    // The message is the only thing standing between a CI operator and ten
    // minutes of wondering why a suite that skips locally is red here.
    setEnv('E2E_REQUIRE_ENV', '1');
    expect(() => reportMissingCredentials('tenant access', ['DT_API_TOKEN'])).toThrow(
      /E2E_REQUIRE_ENV is set/,
    );
  });

  it('only warns when the flag is off', () => {
    setEnv('E2E_REQUIRE_ENV', '0');
    expect(() => reportMissingCredentials('some judge', ['SOME_KEY'])).not.toThrow();
  });

  it('throws for a judge gate too, not just the tenant one', () => {
    // The exact regression the module docstring records: guarding only the
    // tenant variables let a required run skip half the suite and stay green.
    setEnv('E2E_REQUIRE_ENV', '1');
    expect(() => reportMissingCredentials('openai judge', ['OPENAI_API_KEY'])).toThrow();
  });
});

describe('redactSecrets', () => {
  it('redacts a value that appears verbatim', () => {
    setEnv('DT_API_TOKEN', 'dt0c01.SYNTHETIC.TOKENFORREDACTIONTEST');
    expect(redactSecrets('tenant said dt0c01.SYNTHETIC.TOKENFORREDACTIONTEST is invalid')).toBe(
      'tenant said <redacted:DT_API_TOKEN> is invalid',
    );
  });

  it('redacts the slash-stripped spelling of the tenant host', () => {
    // tenant() strips a trailing slash before use, so a secret stored with one
    // reaches the output in a form the runner's exact-match masking misses.
    setEnv('DT_APPS_ENDPOINT', 'https://synthetic-tenant.example.com/');
    expect(redactSecrets('request to https://synthetic-tenant.example.com failed')).not.toContain(
      'synthetic-tenant.example.com',
    );
  });

  it('redacts a percent-encoded key, as the Gemini probe URL produces', () => {
    // dt-eval-cli/src/probe/provider.ts places the key in the request URL, where
    // it is percent-encoded — so the raw value no longer matches.
    setEnv('GEMINI_API_KEY', 'synthetic+key/with+base64=chars');
    const encoded = encodeURIComponent('synthetic+key/with+base64=chars');
    expect(redactSecrets(`GET https://host/v1?key=${encoded}`)).not.toContain(encoded);
  });

  it('redacts an AWS ARN and account id that no secret list can enumerate', () => {
    const text = 'User: arn:aws:iam::123456789012:user/e2e is not authorized';
    const out = redactSecrets(text);
    expect(out).not.toContain('arn:aws:iam::123456789012:user/e2e');
    expect(out).not.toContain('123456789012');
  });

  it('leaves a value shorter than the threshold alone', () => {
    // Documented behaviour, not an oversight — a 4-character token would match
    // by coincidence. warnAboutShortSecrets makes it audible.
    setEnv('DT_API_TOKEN', 'short');
    expect(redactSecrets('the word short appears here')).toContain('short');
  });
});

describe('assertNoSecrets', () => {
  it('catches a secret in stdout', () => {
    const secret = 'sk-synthetic-0123456789abcdef';
    expect(() =>
      assertNoSecrets(cliResult({ output: `error: key ${secret} rejected` }), [secret]),
    ).toThrow(/leaked into the output/);
  });

  it('catches a secret that only appears percent-encoded', () => {
    const secret = 'synthetic+secret/value1234';
    expect(() =>
      assertNoSecrets(cliResult({ output: `url?key=${encodeURIComponent(secret)}` }), [secret]),
    ).toThrow(/leaked into the output/);
  });

  it('scans captured HOME files, not just the streams', () => {
    const secret = 'dt0c01.SYNTHETIC.LEAKEDINTOTHERUNLOG';
    expect(() =>
      assertNoSecrets(
        cliResult({ output: 'all fine', homeFiles: { '.dt-eval/runs.json': `{"t":"${secret}"}` } }),
        [secret],
      ),
    ).toThrow(/leaked into the output/);
  });

  it('does not fire on clean output', () => {
    expect(() =>
      assertNoSecrets(cliResult({ output: 'nothing to see' }), ['sk-synthetic-0123456789abcdef']),
    ).not.toThrow();
  });
});

describe('assertOutputLacks — the empty-output guard', () => {
  it('refuses to pass on empty output', () => {
    // Without this, a command that died before printing a line satisfies every
    // absence check trivially — and in tests where this is the only assertion,
    // that is the whole test passing on silence.
    expect(() => assertOutputLacks(cliResult({ output: '' }), 'Evaluating')).toThrow(
      /printed nothing at all/,
    );
  });

  it('still fails when the needle is present', () => {
    expect(() => assertOutputLacks(cliResult({ output: 'Evaluating 3 spans' }), 'Evaluating'),
    ).toThrow(/expected output NOT to contain/);
  });

  it('passes on non-empty output without the needle', () => {
    expect(() => assertOutputLacks(cliResult({ output: 'Fetching spans' }), 'Evaluating'),
    ).not.toThrow();
  });
});

describe('parseJsonStdout', () => {
  it('reads a single-line object', () => {
    expect(parseJsonStdout(cliResult({ stdout: '{"runId":"run-1"}' }))).toEqual({ runId: 'run-1' });
  });

  it('reads a pretty-printed object, which a last-line parse would miss', () => {
    // --dry-run prints multi-line JSON (runner/index.ts).
    const stdout = '{\n  "runId": "run-2",\n  "spans": 4\n}';
    expect(parseJsonStdout(cliResult({ stdout }))).toEqual({ runId: 'run-2', spans: 4 });
  });

  it('takes the last object when an error object follows the result', () => {
    // run prints {"error": …} after the result when appendRunRecord throws, so
    // slicing first-{ to last-} would span both and yield invalid JSON.
    const stdout = '{"runId":"run-3","resultsWritten":2}\n{"error":"run log unwritable"}';
    expect(parseJsonStdout(cliResult({ stdout }))).toEqual({ error: 'run log unwritable' });
  });

  it('skips human-readable preamble before the object', () => {
    const stdout = 'Fetching spans...\nEvaluating 2 spans\n{"runId":"run-4"}';
    expect(parseJsonStdout(cliResult({ stdout }))).toEqual({ runId: 'run-4' });
  });

  it('throws when there is no JSON at all, rather than returning undefined', () => {
    expect(() => parseJsonStdout(cliResult({ stdout: 'no json here' }))).toThrow(
      /expected a JSON object/,
    );
  });

  it('terminates on unbalanced braces instead of looping forever', () => {
    // The start === 0 guard: lastIndexOf('{', -1) searches from 0 rather than
    // returning -1, so a stdout beginning with { would otherwise spin.
    expect(() => parseJsonStdout(cliResult({ stdout: '{not json}' }))).toThrow();
  });
});
