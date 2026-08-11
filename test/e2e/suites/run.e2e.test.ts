/**
 * `dt-evals run` — the happy path end to end, plus each mode's contract.
 * Assertions are about *shape and behaviour*, never score values, since a
 * judge is non-deterministic near the decision boundary. Deterministic
 * outcomes (threshold cases) come from an impossible threshold, not a
 * predicted score.
 */

import { describe, expect, it } from 'vitest';
import {
  assertExitCode,
  assertNoSecrets,
  assertOutputContains,
  assertOutputLacks,
  parseJsonStdout,
} from '../src/assert.js';
import { runCli } from '../src/cli.js';
import { baselineConfig, baselineEnv, judgeFromEnv, toConfigFile } from '../src/config.js';
import { DynatraceClient } from '../src/dynatrace.js';
import { e2eEnabled, tenant } from '../src/env.js';
import { runCiTimeoutMs, runService } from '../src/fixtures.js';

const judge = judgeFromEnv();
const enabled = e2eEnabled() && !!judge;

const RUNS_LOG = '.dt-eval/runs.json';

/** Margin above the CLI's own {@link runCiTimeoutMs} budget for vitest's outer test timeout: assertions plus a little slack. */
const TEST_TIMEOUT_MARGIN_MS = 20_000;

/**
 * Computed once, only when the suite will actually run. `describe.skipIf`'s factory still
 * executes during collection even when skipped, so calling `runCiTimeoutMs()` unconditionally
 * would make a malformed `E2E_FIXTURE_LOOKBACK` crash collection for contributors who have no
 * tenant credentials and expect a clean skip. Unused (0) when `enabled` is false.
 */
const CI_TIMEOUT_MS = enabled ? runCiTimeoutMs() : 0;

/** Shape of the JSON `run --ci` prints. */
interface CiResult {
  runId: string;
  spansEvaluated: number;
  resultsWritten: number;
  errors: number;
  errorSamples: string[];
  thresholdBreaches: Array<{ metric: string; traceId: string; score: number }>;
  durationMs: number;
  evaluatorResults: Array<{ metric: string; successes: number; total: number; errors: number }>;
}

describe.skipIf(!enabled)('run', () => {
  describe('--dry-run', () => {
    it('fetches and prepares, then writes nothing at all', async () => {
      const result = await runCli(['run', '--dry-run', '--ci'], {
        configYaml: toConfigFile(await baselineConfig(judge!)),
        env: await baselineEnv(judge!),
        captureHomeFiles: [RUNS_LOG],
      });

      assertExitCode(result, 0);

      // Own shape: task/span counts, not results.
      const payload = parseJsonStdout(result) as { runId: string; tasks: number; spans: number; metrics: string[] };
      expect(payload.runId).toMatch(/^run-/);
      expect(payload.spans).toBeGreaterThan(0);
      expect(payload.tasks).toBeGreaterThan(0);
      expect(payload.metrics).toContain('toxicity');

      // The point of the mode: no run log left behind.
      expect(result.homeFiles[RUNS_LOG]).toBeUndefined();
      assertNoSecrets(result);
    });

    it('does not call the judge', async () => {
      // Pins the better-than-documented behaviour: a dry run that bills a judge would be a surprise.
      const result = await runCli(['run', '--dry-run', '--ci'], {
        configYaml: toConfigFile(await baselineConfig(judge!)),
        env: await baselineEnv(judge!),
      });

      assertExitCode(result, 0);
      assertOutputLacks(result, 'Evaluating');
    });

    it('uses a needle a real run actually prints', async () => {
      // Positive control for the assertOutputLacks case above.
      const base = await baselineConfig(judge!);
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile({
          ...base,
          scope: { ...base.scope, sampling: { strategy: 'latest', count: 1 } },
        }),
        env: await baselineEnv(judge!),
        timeoutMs: 180_000,
      });

      assertExitCode(result, 0);
      assertOutputContains(result, 'Evaluating');
    }, 200_000);
  });

  describe('--ci', () => {
    it('prints a machine-readable result, writes to the tenant, and logs the run', async () => {
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile(await baselineConfig(judge!)),
        env: await baselineEnv(judge!),
        captureHomeFiles: [RUNS_LOG],
        timeoutMs: CI_TIMEOUT_MS,
      });

      assertExitCode(result, 0);
      const ci = parseJsonStdout(result) as CiResult;

      expect(ci.runId).toMatch(/^run-/);
      expect(ci.spansEvaluated).toBeGreaterThan(0);
      expect(ci.resultsWritten).toBeGreaterThan(0);
      expect(ci.thresholdBreaches).toEqual([]);
      expect(ci.durationMs).toBeGreaterThan(0);

      // --ci's exit code is driven only by threshold breaches, not judge errors.
      expect(ci.errors, `judge errors: ${JSON.stringify(ci.errorSamples)}`).toBe(0);

      const toxicity = ci.evaluatorResults.find(r => r.metric === 'toxicity');
      expect(toxicity).toBeDefined();
      expect(toxicity!.total).toBeGreaterThan(0);
      expect(toxicity!.successes).toBe(toxicity!.total);

      // The run log is a summary; results live in the tenant.
      const log = JSON.parse(result.homeFiles[RUNS_LOG] ?? '[]') as Array<Record<string, unknown>>;
      const entry = log.find(r => r['runId'] === ci.runId);
      expect(entry, `run ${ci.runId} missing from ${RUNS_LOG}`).toBeDefined();
      expect(entry!['resultsWritten']).toBe(ci.resultsWritten);
      expect(entry!['spansEvaluated']).toBe(ci.spansEvaluated);

      assertNoSecrets(result);
    }, CI_TIMEOUT_MS + TEST_TIMEOUT_MARGIN_MS);

    it('lands the results in the destination tenant, queryable and correctly shaped', async () => {
      // The round trip: not "the CLI said it wrote results" but "the tenant returns them".
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile(await baselineConfig(judge!)),
        env: await baselineEnv(judge!),
        timeoutMs: CI_TIMEOUT_MS,
      });
      assertExitCode(result, 0);
      const ci = parseJsonStdout(result) as CiResult;

      // Without this, an unseeded tenant makes the test vacuously green.
      expect(
        ci.resultsWritten,
        'the run wrote no results, so there is no round trip to verify — check the fixtures were seeded',
      ).toBeGreaterThan(0);

      const { appsEndpoint, apiToken } = await tenant();
      const client = new DynatraceClient(appsEndpoint, apiToken);

      const records = await client.pollUntilRecords(
        `fetch bizevents, from:now() - 30m
| filter event.type == "gen_ai.evaluation.result"
| filter dt.eval.run_id == "${ci.runId}"
| fields dt.eval.run_id, trace_id, gen_ai.evaluation.name, gen_ai.evaluation.score.label, gen_ai.evaluation.method, dt.service.name`,
        { timeoutMs: 120_000, intervalMs: 10_000, minRecords: ci.resultsWritten },
      );

      expect(records.length).toBe(ci.resultsWritten);

      for (const record of records) {
        expect(record['dt.eval.run_id']).toBe(ci.runId);
        expect(record['trace_id']).toBeTruthy();
        expect(record['gen_ai.evaluation.name']).toBeTruthy();
        expect(record['gen_ai.evaluation.method']).toBe('llm_as_judge');
        // Pass/fail only, per ADR-0015.
        expect(['pass', 'fail']).toContain(record['gen_ai.evaluation.score.label']);
        expect(record['dt.service.name']).toBe(runService());
      }

      // `scanned` is a shape control: if zero, the filter matched nothing and leaked=0 proves nothing.
      const withContent = await client.execute(
        `fetch bizevents, from:now() - 30m
| filter dt.eval.run_id == "${ci.runId}"
| summarize scanned = count(), leaked = countIf(isNotNull(gen_ai.evaluation.input.question))`,
      );
      expect(
        Number(withContent[0]?.['scanned'] ?? 0),
        'the privacy check scanned no records at all, so leaked=0 means nothing',
      ).toBeGreaterThan(0);
      expect(Number(withContent[0]?.['leaked'] ?? 0)).toBe(0);
    }, CI_TIMEOUT_MS + 300_000);

    it('writes the prompt only when --store-evaluated-prompt asks for it', async () => {
      // Positive control for the privacy assertion above.
      const base = await baselineConfig(judge!);
      const result = await runCli(['run', '--ci', '--store-evaluated-prompt'], {
        configYaml: toConfigFile({
          ...base,
          scope: { ...base.scope, sampling: { strategy: 'latest', count: 1 } },
        }),
        env: await baselineEnv(judge!),
        timeoutMs: 180_000,
      });

      assertExitCode(result, 0);
      const ci = parseJsonStdout(result) as CiResult;
      expect(ci.resultsWritten).toBeGreaterThan(0);

      const { appsEndpoint, apiToken } = await tenant();
      const client = new DynatraceClient(appsEndpoint, apiToken);

      const records = await client.pollUntilRecords(
        `fetch bizevents, from:now() - 30m
| filter event.type == "gen_ai.evaluation.result"
| filter dt.eval.run_id == "${ci.runId}"
| filter isNotNull(gen_ai.evaluation.input.question)
| fields dt.eval.run_id`,
        { timeoutMs: 120_000, intervalMs: 10_000, minRecords: ci.resultsWritten },
      );

      expect(
        records.length,
        'the flag was set but no record carries gen_ai.evaluation.input.question',
      ).toBe(ci.resultsWritten);

      assertNoSecrets(result);
    }, 480_000);
  });

  describe('threshold breaches', () => {
    // Unreachable, so every score breaches regardless of what the judge returns.
    const alwaysBreaches = { alerts: { thresholds: { toxicity: 2 } } };

    it('exits 1 in --ci', async () => {
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile(await baselineConfig(judge!, alwaysBreaches)),
        env: await baselineEnv(judge!),
        timeoutMs: CI_TIMEOUT_MS,
      });

      assertExitCode(result, 1);
      const ci = parseJsonStdout(result) as CiResult;
      expect(ci.thresholdBreaches.length).toBeGreaterThan(0);
      expect(ci.errors, `judge errors: ${JSON.stringify(ci.errorSamples)}`).toBe(0);
      assertNoSecrets(result);
    }, CI_TIMEOUT_MS + TEST_TIMEOUT_MARGIN_MS);

    it('warns but exits 0 in the default mode', async () => {
      const result = await runCli(['run'], {
        configYaml: toConfigFile(await baselineConfig(judge!, alwaysBreaches)),
        env: await baselineEnv(judge!),
        timeoutMs: CI_TIMEOUT_MS,
      });

      assertExitCode(result, 0);
      assertOutputContains(result, 'Threshold breaches:');
      assertOutputContains(result, 'Evaluation results:');
      assertNoSecrets(result);
    }, CI_TIMEOUT_MS + TEST_TIMEOUT_MARGIN_MS);
  });
});
