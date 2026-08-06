/**
 * Harness self-checks: the properties every other CLI-driven test relies on.
 *
 * These assert the *test rig*, not dt-evals behaviour. If the rig leaks the
 * developer's credentials or state into a run, then a green suite means nothing —
 * a negative test would pass because a real token happened to be in scope. So
 * the isolation the design doc's "state is shared and global" constraint demands
 * is verified here explicitly, and cheaply: no tenant, no judge.
 */

import { describe, expect, it } from 'vitest';
import {
  assertExitCode,
  assertNoSecrets,
  assertOutputContains,
  assertOutputLacks,
  redactSecrets,
} from '../src/assert.js';
import { buildChildEnv, runCli } from '../src/cli.js';

describe('CLI harness', () => {
  it('runs the built CLI and reports its version', async () => {
    const result = await runCli(['--version']);

    assertExitCode(result, 0);
    // Confirms the artifact under test is the built bundle, with the version
    // tsup injected at build time — not a stale dist from an older checkout.
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    assertNoSecrets(result);
  });

  it('builds the child environment from scratch, without the parent', () => {
    // The load-bearing property of the whole suite, and the design doc's
    // Isolation requirement ("its environment is built explicitly, never
    // inherited, so a developer's real DT_API_TOKEN can't leak in"). Without it,
    // every "missing credentials" test in validate.e2e.test.ts could pass for
    // the wrong reason.
    //
    // Asserted on the constructed key set rather than on the CLI's output. Two
    // earlier versions checked a canary against stdout — first passing it *to*
    // the child, then setting it on the parent — and neither could fail: the CLI
    // never echoes its environment, so a variable it ignores is invisible in
    // stdout whether it was inherited or not. A mutation that spread
    // process.env into the child left both versions green.
    const canary = 'canary-value-must-not-appear';
    const previous = process.env['E2E_CANARY'];
    process.env['E2E_CANARY'] = canary;

    try {
      const env = buildChildEnv('/tmp/e2e-fake-home', { EXPLICIT: 'passed-in' });

      expect(Object.keys(env).sort()).toEqual(['EXPLICIT', 'HOME', 'NO_COLOR', 'PATH']);
      expect(env).not.toHaveProperty('E2E_CANARY');
      expect(Object.values(env)).not.toContain(canary);
    } finally {
      // The suite runs in a single fork, so a stray variable would outlive this
      // test and reach every later one.
      if (previous === undefined) delete process.env['E2E_CANARY'];
      else process.env['E2E_CANARY'] = previous;
    }
  });

  it('does not let a parent-set credential reach the CLI', async () => {
    // The behavioural half, using a variable the CLI actually acts on. A leaked
    // DT_API_TOKEN would take `validate` past its token check and into a
    // connection attempt, so the "not set" message is the observable proof that
    // nothing crossed over.
    const saved = {
      token: process.env['DT_API_TOKEN'],
      url: process.env['DT_ENV_URL'],
    };
    process.env['DT_API_TOKEN'] = 'dt0c01.PARENTLEAKCANARY.MUSTNOTREACHTHECHILD';
    process.env['DT_ENV_URL'] = 'https://parent-leak-canary.invalid';

    try {
      const result = await runCli(['validate'], {
        configYaml: [
          'schemaVersion: 2',
          'dynatrace:',
          '  environmentUrl: https://example.invalid',
          'judge:',
          '  provider: openai',
          'scope:',
          '  since: 1h',
          'metrics:',
          '  enabled:',
          '    - toxicity',
        ].join('\n'),
      });

      assertExitCode(result, 1);
      assertOutputContains(result, 'API token not set');
      assertOutputLacks(result, 'parent-leak-canary.invalid');
      assertNoSecrets(result);
    } finally {
      for (const [key, value] of [
        ['DT_API_TOKEN', saved.token],
        ['DT_ENV_URL', saved.url],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('runs in a private working directory, so no repo config leaks in', async () => {
    // dt-eval-cli/src/index.ts:12 auto-loads `.env` from the working directory
    // and loadConfig() reads ./.dt-eval.yaml. Running in the repo would pick up
    // the developer's real tenant and token. An empty temp cwd means the CLI
    // reports finding no config at all — which is the observable proof that
    // nothing leaked.
    const result = await runCli(['validate']);

    assertExitCode(result, 1);
    assertOutputContains(result, 'No .dt-eval.yaml in');
    assertNoSecrets(result);
  });

  it('picks up a config written into its private working directory', async () => {
    // The positive half: tests can still control the CLI's configuration, they
    // just do it through the isolated cwd rather than the repo.
    const result = await runCli(['validate'], {
      configYaml: [
        'schemaVersion: 2',
        'dynatrace:',
        '  environmentUrl: not-a-url',
        'judge:',
        '  provider: openai',
        'scope:',
        '  since: 1h',
        'metrics:',
        '  enabled:',
        '    - toxicity',
      ].join('\n'),
    });

    assertExitCode(result, 1);
    // The config was read: this is a schema complaint about the value we wrote,
    // not the "no config found" warning from the previous case.
    assertOutputContains(result, 'Config schema invalid');
    assertOutputLacks(result, 'No .dt-eval.yaml in');
    assertNoSecrets(result);
  });

  it('redacts secrets from failure messages, so reporting a leak is not a leak', () => {
    // assertNoSecrets refuses to echo a value, but any *other* assertion failing
    // on the same result inlines the raw output into its message, and vitest
    // prints that to the run log untruncated.
    //
    // Uses a synthetic token rather than the configured one. Reading
    // DT_API_TOKEN and returning early when unset made this pass vacuously
    // whenever no tenant was configured — a green test that asserted nothing,
    // guarding the very mechanism that keeps secrets out of the log.
    const token = 'dt0c01.E2ESYNTHETIC.TOKENVALUEFORREDACTIONTEST';
    const previous = process.env['DT_API_TOKEN'];
    process.env['DT_API_TOKEN'] = token;

    try {
      const redacted = redactSecrets(`tenant said: Api-Token ${token} is invalid`);

      expect(redacted).not.toContain(token);
      expect(redacted).toContain('<redacted:DT_API_TOKEN>');
    } finally {
      if (previous === undefined) delete process.env['DT_API_TOKEN'];
      else process.env['DT_API_TOKEN'] = previous;
    }
  });

  it('detects a secret that leaks into captured output', async () => {
    // A negative control for assertNoSecrets itself. The CLI echoes an unknown
    // command back in its error message, so passing a secret-shaped argument is
    // a reliable way to get one into the output — proving the scanner would
    // catch a real leak such as the Gemini key in the probe URL
    // (dt-eval-cli/src/probe/provider.ts:115).
    const fakeSecret = 'sk-e2e-canary-0123456789abcdef';
    const result = await runCli([`definitely-not-a-command-${fakeSecret}`]);

    expect(result.output).toContain(fakeSecret);
    expect(() => assertNoSecrets(result, [fakeSecret])).toThrow(/leaked into the output/);
  });
});
