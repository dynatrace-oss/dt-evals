/**
 * Harness self-checks: the properties every other CLI-driven test relies on.
 * These assert the *test rig*, not dt-evals behaviour — if the rig leaks
 * credentials or state, a green suite means nothing.
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
    // Confirms this is the built bundle, not a stale dist from an older checkout.
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    assertNoSecrets(result);
  });

  it('builds the child environment from scratch, without the parent', () => {
    // Asserted on the constructed key set, not the CLI's output — the CLI
    // never echoes its env, so a stdout-based canary check can't fail.
    const canary = 'canary-value-must-not-appear';
    const previous = process.env['E2E_CANARY'];
    process.env['E2E_CANARY'] = canary;

    try {
      const env = buildChildEnv('/tmp/e2e-fake-home', { EXPLICIT: 'passed-in' });

      expect(Object.keys(env).sort()).toEqual(['EXPLICIT', 'HOME', 'NO_COLOR', 'PATH']);
      expect(env).not.toHaveProperty('E2E_CANARY');
      expect(Object.values(env)).not.toContain(canary);
    } finally {
      if (previous === undefined) delete process.env['E2E_CANARY'];
      else process.env['E2E_CANARY'] = previous;
    }
  });

  it('does not let a parent-set credential reach the CLI', async () => {
    // A leaked DT_API_TOKEN would take `validate` past its token check.
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
    // The CLI auto-loads ./.env and ./.dt-eval.yaml.
    const result = await runCli(['validate']);

    assertExitCode(result, 1);
    assertOutputContains(result, 'No .dt-eval.yaml in');
    assertNoSecrets(result);
  });

  it('picks up a config written into its private working directory', async () => {
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
    // A schema complaint, not the "no config" warning — confirms the config was read.
    assertOutputContains(result, 'Config schema invalid');
    assertOutputLacks(result, 'No .dt-eval.yaml in');
    assertNoSecrets(result);
  });

  it('redacts secrets from failure messages, so reporting a leak is not a leak', () => {
    // Synthetic token, not the configured one, so this can't pass vacuously when unset.
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
    // Negative control: the CLI echoes an unknown command back verbatim.
    const fakeSecret = 'sk-e2e-canary-0123456789abcdef';
    const result = await runCli([`definitely-not-a-command-${fakeSecret}`]);

    expect(result.output).toContain(fakeSecret);
    expect(() => assertNoSecrets(result, [fakeSecret])).toThrow(/leaked into the output/);
  });
});
