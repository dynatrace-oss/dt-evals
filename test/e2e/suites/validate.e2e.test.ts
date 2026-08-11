/**
 * `dt-evals validate` — the pre-flight, both directions. Each of its five
 * probes is checked for passing *and* failing cleanly, since a probe that
 * never fails is indistinguishable from one that isn't wired up.
 */

import { describe, it } from 'vitest';
import {
  assertExitCode,
  assertNoSecrets,
  assertOutputContains,
  assertOutputLacks,
} from '../src/assert.js';
import { runCli } from '../src/cli.js';
import { baselineConfig, baselineEnv, judgeFromEnv, toConfigFile } from '../src/config.js';
import { e2eEnabled, tenant } from '../src/env.js';

const judge = judgeFromEnv();

/** Stable fragments of each probe's success line — substrings, so wording changes don't break the suite. */
const PROBE_SUCCESS = {
  schema: 'Config schema valid',
  // The ✓ marker is deliberate: without it "origin connection" is a substring of the failure line too.
  origin: '✓ origin connection',
  spansBucket: 'origin can read spans bucket',
  destination: '✓ destination connection',
  provider: 'Evaluator provider reachable',
  evaluators: 'built-in evaluators available',
} as const;

/** The matching failure line for each probe, kept as its own map rather than derived — the wording varies. */
const PROBE_FAILURE: Record<keyof typeof PROBE_SUCCESS, string> = {
  schema: 'Config schema invalid',
  origin: 'origin connection failed',
  spansBucket: 'origin cannot read spans bucket',
  destination: 'destination connection failed',
  provider: 'Evaluator provider check failed',
  evaluators: 'Failed to load evaluators',
};

describe.skipIf(!e2eEnabled() || !judge)('validate — happy path', () => {
  it('passes every probe against a real tenant and a real provider', async () => {
    const result = await runCli(['validate'], {
      configYaml: toConfigFile(baselineConfig(judge!)),
      env: baselineEnv(judge!),
    });

    // Before the exit code: a named failure says which probe regressed.
    for (const probe of Object.keys(PROBE_SUCCESS) as Array<keyof typeof PROBE_SUCCESS>) {
      assertOutputContains(result, PROBE_SUCCESS[probe]);
      assertOutputLacks(result, PROBE_FAILURE[probe]);
    }

    assertOutputContains(result, 'All checks passed');
    assertExitCode(result, 0);
    assertNoSecrets(result);
  });
});

describe.skipIf(!e2eEnabled())('validate — failure paths', () => {
  it('exits 1 and names the file when an explicit config path is missing', async () => {
    const result = await runCli(['validate', 'no-such-file.dt-eval.yaml']);

    assertExitCode(result, 1);
    assertOutputContains(result, 'Config file not found');
    assertNoSecrets(result);
  });

  it('exits 1 on a schema-invalid config', async () => {
    const result = await runCli(['validate'], {
      configYaml: toConfigFile({
        schemaVersion: 2,
        dynatrace: { environmentUrl: 'https://example.invalid' },
        judge: { provider: 'openai' },
        scope: { since: 'banana' },
        metrics: { enabled: ['toxicity'] },
      }),
    });

    assertExitCode(result, 1);
    assertOutputContains(result, 'Config schema invalid');
    assertNoSecrets(result);
  });

  it('exits 1 and says the token is unset when no credentials are provided', async () => {
    // Proves the harness isn't leaking credentials: if runCli inherited the parent env, this would fail.
    const result = await runCli(['validate'], {
      configYaml: toConfigFile({
        schemaVersion: 2,
        dynatrace: { environmentUrl: tenant().appsEndpoint },
        judge: { provider: 'openai' },
        scope: { since: '1h' },
        metrics: { enabled: ['toxicity'] },
      }),
    });

    assertExitCode(result, 1);
    assertOutputContains(result, 'API token not set');
    assertNoSecrets(result);
  });

  it('exits 1 and reports a connection failure on a rejected tenant token', async () => {
    const result = await runCli(['validate'], {
      configYaml: toConfigFile({
        schemaVersion: 2,
        dynatrace: { environmentUrl: tenant().appsEndpoint },
        judge: { provider: 'openai' },
        scope: { since: '1h' },
        metrics: { enabled: ['toxicity'] },
      }),
      env: { DT_ENV_URL: tenant().appsEndpoint, DT_API_TOKEN: 'dt0c01.INVALID.INVALID' },
    });

    assertExitCode(result, 1);
    assertOutputContains(result, 'origin connection failed');
    assertNoSecrets(result);
  });

  it('exits 1 on a destination the origin credentials cannot cover', async () => {
    // DT_ORIGIN_* set explicitly: resolveEndpoints falls back to a shared top-level token otherwise.
    const { appsEndpoint, apiToken } = tenant();

    const result = await runCli(['validate'], {
      configYaml: toConfigFile({
        schemaVersion: 2,
        dynatrace: { environmentUrl: appsEndpoint },
        judge: { provider: 'openai' },
        scope: { since: '1h' },
        metrics: { enabled: ['toxicity'] },
      }),
      env: {
        DT_ORIGIN_ENV_URL: appsEndpoint,
        DT_ORIGIN_API_TOKEN: apiToken,
        DT_DESTINATION_ENV_URL: 'https://destination-does-not-resolve.invalid',
        DT_DESTINATION_API_TOKEN: 'dt0c01.INVALID.INVALID',
      },
    });

    assertExitCode(result, 1);
    assertOutputContains(result, PROBE_FAILURE.destination);
    // Origin must still be healthy, or this is the previous test with extra steps.
    assertOutputContains(result, PROBE_SUCCESS.origin);
    assertOutputLacks(result, PROBE_FAILURE.origin);
    assertNoSecrets(result);
  });

  it('exits 1 when the custom evaluator file cannot be loaded', async () => {
    // Valid JSON that isn't an array makes the spread in allPrompts() throw. Safe to plant: throwaway HOME.
    const result = await runCli(['validate'], {
      configYaml: toConfigFile({
        schemaVersion: 2,
        dynatrace: { environmentUrl: tenant().appsEndpoint },
        judge: { provider: 'openai' },
        scope: { since: '1h' },
        metrics: { enabled: ['toxicity'] },
      }),
      filesInHome: { '.config/dt-eval/custom-prompts.json': '{}' },
    });

    assertExitCode(result, 1);
    assertOutputContains(result, PROBE_FAILURE.evaluators);
    assertOutputLacks(result, PROBE_SUCCESS.evaluators);
    assertNoSecrets(result);
  });

  it.skipIf(!judge)('exits 1 and reports the provider when the judge model is bogus', async () => {
    // A real 1-token inference, so a wrong model id surfaces here rather than mid-run.
    const result = await runCli(['validate'], {
      configYaml: toConfigFile(
        baselineConfig({ ...judge!, model: 'definitely-not-a-real-model-id' }),
      ),
      env: baselineEnv(judge!),
    });

    assertExitCode(result, 1);
    assertOutputContains(result, 'Evaluator provider check failed');
    assertNoSecrets(result);
  });

  // Skipped for vertex: it authenticates via ADC, so there's no key to invalidate.
  it.skipIf(!judge || judge.secretEnvKeys.length === 0)(
    'exits 1 and reports the provider on rejected judge credentials',
    async () => {
      // Only credentials invalidated, never the config alongside them (e.g. AWS_REGION).
      const badCredentials: Record<string, string> = Object.fromEntries(
        judge!.secretEnvKeys.map((key) => [key, 'e2e-invalid-credential-value']),
      );

      const result = await runCli(['validate'], {
        configYaml: toConfigFile(baselineConfig(judge!)),
        env: { ...baselineEnv(judge!), ...badCredentials },
      });

      assertExitCode(result, 1);
      assertOutputContains(result, PROBE_FAILURE.provider);
      assertNoSecrets(result);
    },
  );
});
