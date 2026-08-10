/**
 * `dt-evals validate` — the pre-flight, both directions.
 *
 * `validate` is the command the design doc singles out for automation: `doctor`
 * covers the same ground but opens a browser and waits for a token paste, so it
 * cannot run unattended. Each of validate's five probes gets checked for passing
 * *and* for failing cleanly, because a probe that never fails is indistinguishable
 * from one that is not wired up.
 *
 * Cost: one 1-token inference per case that reaches the provider probe.
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
import { e2eEnabled, misscopedToken, tenant } from '../src/env.js';

const judge = judgeFromEnv();

/**
 * Resolved once at module scope so `E2E_REQUIRE_MISSCOPED_TOKEN` fails collection
 * loudly, rather than inside a case that would otherwise just skip.
 */
const misscoped = misscopedToken();

/**
 * Stable fragments of each probe's success line
 * (`dt-eval-cli/src/cli/commands/validate.ts:98-177`). Substrings rather than
 * full messages, so wording changes don't break the suite — only behaviour does.
 */
const PROBE_SUCCESS = {
  schema: 'Config schema valid',
  // The two connectivity needles carry the success marker deliberately.
  // `logger.success` prefixes "✓ " and `logger.error` prefixes "✖ "
  // (dt-eval-cli/src/logger/index.ts:83,93), and without the marker
  // "origin connection" is a substring of "origin connection failed" — so the
  // success assertion would be satisfied by the failure line. The other four
  // needles have no such collision with their failure wording.
  origin: '✓ origin connection',
  spansBucket: 'origin can read spans bucket',
  destination: '✓ destination connection',
  provider: 'Evaluator provider reachable',
  evaluators: 'built-in evaluators available',
} as const;

/**
 * The matching failure line for each probe, verified against
 * `dt-eval-cli/src/cli/commands/validate.ts`.
 *
 * Kept as its own map rather than derived as `${success} failed`: that pattern
 * only ever matches the two connectivity probes, so for the other four the
 * negative assertion was a tautology that could never fire and quietly implied
 * coverage the suite did not have.
 */
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

    // Assert the probes before the exit code: when a single probe regresses, the
    // named failure says which one, where a bare "expected 0, got 1" does not.
    //
    // The spans-bucket probe is included here rather than in its own case. It
    // deserves the attention — Grail answers a query whose token lacks
    // storage:spans:read with SUCCEEDED-and-zero-records rather than a 403, so
    // without the probe a misscoped token merely looks like an empty tenant —
    // but a second identical `validate` invocation to assert a subset of these
    // same lines cost another real 1-token inference for no extra coverage.
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
    // Cheapest negative case: no tenant call, no judge call. The CLI treats an
    // explicit path that does not exist as an error rather than falling back to
    // defaults (validate.ts:74).
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
        // `since` must match /^\d+[smhd]$/ (config/index.ts:242).
        scope: { since: 'banana' },
        metrics: { enabled: ['toxicity'] },
      }),
    });

    assertExitCode(result, 1);
    assertOutputContains(result, 'Config schema invalid');
    assertNoSecrets(result);
  });

  it('exits 1 and says the token is unset when no credentials are provided', async () => {
    // Proves the harness does not leak credentials as much as it proves CLI
    // behaviour: if runCli inherited the developer's environment, DT_API_TOKEN
    // would be present and this would fail.
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
    // The bad token is ours, not a real secret — but the real one must not show
    // up either, which is what the environment isolation guarantees.
    assertNoSecrets(result);
  });

  it('exits 1 on a destination the origin credentials cannot cover', async () => {
    // The destination probe had no failure case, and the generic "API token not
    // set" assertion cannot supply one: the CLI prints `${label} API token not
    // set`, so the same substring matches origin. This drives the two sides
    // apart deliberately.
    //
    // DT_ORIGIN_* is set explicitly rather than DT_ENV_URL/DT_API_TOKEN, because
    // resolveEndpoints falls back to the top-level token for whichever side is
    // missing one (config/schema.ts:160-173) — so a shared token would quietly
    // satisfy the destination and this test would prove nothing.
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
    // The origin half must still be healthy, or this would just be the previous
    // test with extra steps.
    assertOutputContains(result, PROBE_SUCCESS.origin);
    assertOutputLacks(result, PROBE_FAILURE.origin);
    assertNoSecrets(result);
  });

  // Needs a second, deliberately under-scoped token, so it skips until one is
  // provisioned. Breaking the good token is not a substitute: a wholly invalid
  // token fails the connection probe first and the run never reaches this check.
  //
  // This is the only gate that does not honour E2E_REQUIRE_ENV — see
  // misscopedToken() for why, and for the E2E_REQUIRE_MISSCOPED_TOKEN opt-in that
  // stops it skipping forever once the secret exists.
  it.skipIf(!misscoped)(
    'exits 1 when the origin token cannot read the spans bucket',
    async () => {
      // The probe this covers exists because Grail answers a query whose token
      // lacks storage:spans:read with SUCCEEDED-and-zero-records rather than a
      // 403 — so without it a misscoped token is indistinguishable from an empty
      // tenant, and a run reports "no data" instead of "no permission".
      const { appsEndpoint } = tenant();

      const result = await runCli(['validate'], {
        configYaml: toConfigFile({
          schemaVersion: 2,
          dynatrace: { environmentUrl: appsEndpoint },
          judge: { provider: 'openai' },
          scope: { since: '1h' },
          metrics: { enabled: ['toxicity'] },
        }),
        env: {
          DT_ENV_URL: appsEndpoint,
          DT_API_TOKEN: misscoped!,
        },
      });

      assertExitCode(result, 1);
      assertOutputContains(result, PROBE_FAILURE.spansBucket);
      // Connectivity must still be healthy. If the token cannot connect at all
      // this degenerates into the rejected-token test above and says nothing
      // about the bucket scope.
      assertOutputContains(result, PROBE_SUCCESS.origin);
      assertOutputLacks(result, PROBE_FAILURE.origin);
      assertNoSecrets(result);
    },
  );

  it('exits 1 when the custom evaluator file cannot be loaded', async () => {
    // The last probe without a failure case. The only external surface that can
    // break evaluator loading is ~/.config/dt-eval/custom-prompts.json: the
    // store swallows a missing file and even a JSON syntax error
    // (dt-eval-cli/src/prompts/fs-store.ts:11-17), but the parsed value is cast
    // rather than checked, so valid JSON that is not an array makes the spread
    // in allPrompts() throw (dt-eval-lib/src/prompts/lookup.ts:7).
    //
    // Safe to plant because the CLI runs with a throwaway HOME — the
    // developer's real evaluator file is never touched.
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
    // The provider probe fires a real 1-token inference precisely so a wrong
    // model id surfaces here rather than mid-run (probe/provider.ts:1-11). This
    // is the case that would catch a regression turning the probe back into a
    // "is the endpoint reachable" check, which a bogus model would pass.
    const result = await runCli(['validate'], {
      configYaml: toConfigFile(
        baselineConfig({ ...judge!, model: 'definitely-not-a-real-model-id' }),
      ),
      env: baselineEnv(judge!),
    });

    assertExitCode(result, 1);
    assertOutputContains(result, 'Evaluator provider check failed');
    // Raw provider error bodies are echoed on this path, which is exactly where
    // a credential could leak into CI logs.
    assertNoSecrets(result);
  });

  // Skipped for vertex, which has no key to invalidate: it authenticates via
  // Application Default Credentials, so the only thing left to blank is the
  // project — and a missing project is a configuration error, not a rejected
  // credential. Better an honest skip than a test that asserts the wrong cause.
  it.skipIf(!judge || judge.secretEnvKeys.length === 0)(
    'exits 1 and reports the provider on rejected judge credentials',
    async () => {
      // Only the credentials are invalidated, never the configuration that
      // travels alongside them. Blanking AWS_REGION as well made the SDK fail
      // on endpoint resolution, so this passed without a credential ever being
      // rejected — and would have kept passing if bad keys were silently
      // accepted.
      //
      // The private HOME matters here too: it cuts off ~/.aws/credentials, so
      // the AWS SDK's default chain cannot quietly fall back to a real profile.
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
