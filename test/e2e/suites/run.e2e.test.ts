/**
 * `dt-evals run` — the happy path end to end, plus each mode's contract.
 *
 * This is the command that costs money and writes to a tenant, so the modes are
 * asserted separately: `--dry-run` must touch nothing, `--ci` must emit machine
 * output and fail on a threshold breach, and the default must warn but succeed.
 *
 * These assertions are about *shape and behaviour*, never about score values.
 * A judge is non-deterministic near the decision boundary, so an assertion on a
 * number buys flake. Where a deterministic outcome is needed — the threshold
 * cases — it comes from an impossible threshold rather than from a predicted score.
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
import { runService } from '../src/fixtures.js';

const judge = judgeFromEnv();

const RUNS_LOG = '.dt-eval/runs.json';

/** Shape of the JSON `run --ci` prints (`dt-eval-cli/src/runner/index.ts:414`). */
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

describe.skipIf(!e2eEnabled() || !judge)('run', () => {
  describe('--dry-run', () => {
    it('fetches and prepares, then writes nothing at all', async () => {
      const result = await runCli(['run', '--dry-run', '--ci'], {
        configYaml: toConfigFile(baselineConfig(judge!)),
        env: baselineEnv(judge!),
        captureHomeFiles: [RUNS_LOG],
      });

      assertExitCode(result, 0);

      // The dry-run payload is its own shape — task/span counts, not results
      // (runner/index.ts:221).
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
      // Worth pinning because the design doc describes --dry-run as "real fetch
      // + judge, then return before writing any record", while the implementation
      // returns at runner/index.ts:220 — before the evaluation loop. The
      // implementation's behaviour is the better one (a dry run that bills a
      // judge is a surprise), so this locks it in and documents the divergence.
      const result = await runCli(['run', '--dry-run', '--ci'], {
        configYaml: toConfigFile(baselineConfig(judge!)),
        env: baselineEnv(judge!),
      });

      assertExitCode(result, 0);
      assertOutputLacks(result, 'Evaluating');
    });

    it('uses a needle a real run actually prints', async () => {
      // Positive control for the assertion above. `assertOutputLacks` guards
      // against empty output, but not against a needle that stopped matching:
      // if the CLI reworded "Evaluating N spans × M metrics", the dry-run
      // assertion would pass forever while testing nothing.
      //
      // Cheap because it reuses the --ci run's own output rather than adding an
      // invocation: one judge call's worth of spans, already being paid for by
      // the case below.
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile(
          baselineConfig(judge!, { scope: { ...baselineConfig(judge!).scope, sampling: { strategy: 'latest', count: 1 } } }),
        ),
        env: baselineEnv(judge!),
        timeoutMs: 180_000,
      });

      assertExitCode(result, 0);
      assertOutputContains(result, 'Evaluating');
    }, 200_000);
  });

  describe('--ci', () => {
    it('prints a machine-readable result, writes to the tenant, and logs the run', async () => {
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile(baselineConfig(judge!)),
        env: baselineEnv(judge!),
        captureHomeFiles: [RUNS_LOG],
        timeoutMs: 180_000,
      });

      assertExitCode(result, 0);
      const ci = parseJsonStdout(result) as CiResult;

      expect(ci.runId).toMatch(/^run-/);
      expect(ci.spansEvaluated).toBeGreaterThan(0);
      expect(ci.resultsWritten).toBeGreaterThan(0);
      expect(ci.thresholdBreaches).toEqual([]);
      expect(ci.durationMs).toBeGreaterThan(0);

      // The gotcha the design doc calls out: in --ci the exit code is driven
      // *only* by threshold breaches, so a run whose judge failed on every span
      // still exits 0. Checking the exit code alone would call that a pass.
      expect(ci.errors, `judge errors: ${JSON.stringify(ci.errorSamples)}`).toBe(0);

      const toxicity = ci.evaluatorResults.find(r => r.metric === 'toxicity');
      expect(toxicity).toBeDefined();
      expect(toxicity!.total).toBeGreaterThan(0);
      // successes == total only because errors == 0 above; this asserts the
      // per-evaluator accounting agrees with the run-level total.
      expect(toxicity!.successes).toBe(toxicity!.total);

      // The run log is a summary, not the results — those live in the tenant.
      const log = JSON.parse(result.homeFiles[RUNS_LOG] ?? '[]') as Array<Record<string, unknown>>;
      const entry = log.find(r => r['runId'] === ci.runId);
      expect(entry, `run ${ci.runId} missing from ${RUNS_LOG}`).toBeDefined();
      expect(entry!['resultsWritten']).toBe(ci.resultsWritten);
      expect(entry!['spansEvaluated']).toBe(ci.spansEvaluated);

      assertNoSecrets(result);
    }, 200_000);

    it('lands the results in the destination tenant, queryable and correctly shaped', async () => {
      // The round trip the design doc asks for: not "the CLI said it wrote 2
      // results" but "the tenant returns them". Asserts the verdict label is
      // present and valid, never a specific score.
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile(baselineConfig(judge!)),
        env: baselineEnv(judge!),
        timeoutMs: 180_000,
      });
      assertExitCode(result, 0);
      const ci = parseJsonStdout(result) as CiResult;

      // Without this the whole test is vacuous on an unseeded tenant, which is
      // the likeliest way for it to be wrong. `run` exits 0 on zero spans — the
      // exit code is driven only by threshold breaches — so resultsWritten would
      // be 0, `minRecords: 0` would be satisfied by the first empty poll,
      // `toBe(0)` would hold, and the six assertions in the loop below would
      // never execute. Green, having proven nothing, in the one test that
      // verifies the round trip actually happens.
      expect(
        ci.resultsWritten,
        'the run wrote no results, so there is no round trip to verify — check the fixtures were seeded',
      ).toBeGreaterThan(0);

      const { appsEndpoint, apiToken } = tenant();
      const client = new DynatraceClient(appsEndpoint, apiToken);

      // Bizevent ingestion is not synchronous with the API call returning, so poll.
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
        // Pass/fail only — the design doc and ADR-0015 both rule out asserting
        // the score itself.
        expect(['pass', 'fail']).toContain(record['gen_ai.evaluation.score.label']);
        expect(record['dt.service.name']).toBe(runService());
      }

      // By default the CLI leaves the evaluated prompt and response out of what
      // it writes back. Confirming that keeps a regression from quietly starting
      // to ship user content to the tenant.
      //
      // `summarize` without `by:` always returns exactly one record, so leaked=0
      // also comes back for a wrong field name, a wrong run id, or an empty
      // result — the same DQL trap contract.e2e.test.ts guards against. The
      // count of *all* this run's records is therefore taken in the same query
      // as a shape control: if `scanned` is zero the filter matched nothing and
      // the privacy assertion proved nothing, whatever `leaked` says.
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
      // 480s rather than 320s: runCli 180s + poll 120s left only 20s of slack,
      // and pollUntilRecords can overshoot its deadline by a whole HTTP timeout
      // because it checks the clock only after a query returns.
    }, 480_000);

    it('writes the prompt only when --store-evaluated-prompt asks for it', async () => {
      // The positive control for the privacy assertion above, and the reason it
      // is worth a second run: without it, that assertion silently stops covering
      // anything the moment `gen_ai.evaluation.input.question` is renamed —
      // `countIf` on an attribute no span carries returns 0 exactly like
      // compliance does. Here the same field must come back *populated*, so the
      // two tests fail in opposite directions and the field name is pinned.
      //
      // Deliberately the one place the suite writes user content to the tenant.
      // Kept to a single span (`count: 1`) to bound both the judge bill and how
      // much fixture text lands there.
      const base = baselineConfig(judge!);
      const result = await runCli(['run', '--ci', '--store-evaluated-prompt'], {
        configYaml: toConfigFile({
          ...base,
          scope: { ...base.scope, sampling: { strategy: 'latest', count: 1 } },
        }),
        env: baselineEnv(judge!),
        timeoutMs: 180_000,
      });

      assertExitCode(result, 0);
      const ci = parseJsonStdout(result) as CiResult;
      expect(ci.resultsWritten).toBeGreaterThan(0);

      const { appsEndpoint, apiToken } = tenant();
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
        'the flag was set but no record carries gen_ai.evaluation.input.question — ' +
          'either the flag regressed or the attribute was renamed, which would also ' +
          'have silently disabled the default-off assertion above',
      ).toBe(ci.resultsWritten);

      assertNoSecrets(result);
    }, 480_000);
  });

  describe('threshold breaches', () => {
    // An unreachable threshold makes every score a breach regardless of what the
    // judge returns, so the two modes' contracts can be asserted deterministically
    // without predicting a score. Scores are 0..1; a threshold of 2 always breaches.
    const alwaysBreaches = { alerts: { thresholds: { toxicity: 2 } } };

    it('exits 1 in --ci', async () => {
      const result = await runCli(['run', '--ci'], {
        configYaml: toConfigFile(baselineConfig(judge!, alwaysBreaches)),
        env: baselineEnv(judge!),
        timeoutMs: 180_000,
      });

      assertExitCode(result, 1);
      const ci = parseJsonStdout(result) as CiResult;
      expect(ci.thresholdBreaches.length).toBeGreaterThan(0);
      // The breach must be the *only* reason for the non-zero exit — otherwise
      // this test would also pass on a run that simply failed.
      expect(ci.errors, `judge errors: ${JSON.stringify(ci.errorSamples)}`).toBe(0);
      assertNoSecrets(result);
    }, 200_000);

    it('warns but exits 0 in the default mode', async () => {
      const result = await runCli(['run'], {
        configYaml: toConfigFile(baselineConfig(judge!, alwaysBreaches)),
        env: baselineEnv(judge!),
        timeoutMs: 180_000,
      });

      assertExitCode(result, 0);
      assertOutputContains(result, 'Threshold breaches:');
      // Human-facing mode: the results table, not JSON.
      assertOutputContains(result, 'Evaluation results:');
      assertNoSecrets(result);
    }, 200_000);
  });
});
