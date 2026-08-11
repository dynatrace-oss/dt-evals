/**
 * Does the evaluation actually work? — the design doc's "Eval logic" check.
 *
 * Every other `run` assertion is structural: output shape, exit codes, the run
 * log, the destination round-trip. They prove data moves through the pipeline.
 * None of them can fail on a *wrong* verdict — `run.e2e.test.ts` asserts the
 * label is one of `pass`/`fail`, which holds whichever way the judge decides.
 *
 * This file closes that gap. The fixture dataset ships, per evaluator, one
 * clearly-passing and one clearly-failing conversation tagged with the verdict
 * it should receive, and here we check dt-evals returns that verdict.
 *
 * Still no assertion on a score *value* — only the pass/fail direction, per
 * ADR-0015 and the design doc. Direction on a deliberately clear-cut case is
 * about as stable as a real judge gets; if it does start flapping, that belongs
 * in the flaky lane rather than being weakened into a tautology.
 *
 * Cost: one `run` over every fixture span in the lookback window (baselineConfig's
 * uncapped `sampling: { strategy: 'latest' }`), not just the two cases we assert
 * on — coverage tracks whatever fixtures.json seeded, not a hand-picked subset.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { assertExitCode, assertRecords, parseJsonStdout } from '../src/assert.js';
import { runCli } from '../src/cli.js';
import { baselineConfig, baselineEnv, judgeFromEnv, toConfigFile } from '../src/config.js';
import { DynatraceClient } from '../src/dynatrace.js';
import { e2eEnabled, tenant } from '../src/env.js';
import {
  FIXTURE_SERVICE_NAME,
  VERDICT_CASES,
  conversationId,
  fixtureLookback,
  lastTurnTraceQuery,
} from '../src/fixtures.js';

const judge = judgeFromEnv();

describe.skipIf(!e2eEnabled() || !judge)('eval logic — verdict direction', () => {
  let client: DynatraceClient;
  /** caseName -> trace id of that case's most recent final turn. */
  const targetTrace = new Map<string, string>();

  beforeAll(async () => {
    const { appsEndpoint, apiToken } = tenant();
    client = new DynatraceClient(appsEndpoint, apiToken);

    // Resolved before the run, not after: the run scores whatever exists when it
    // fetches, so a span that appeared afterwards would have no verdict and look
    // like a failure of the evaluator rather than a race.
    for (const { caseName } of VERDICT_CASES) {
      const id = conversationId(caseName);
      const records = await client.execute(lastTurnTraceQuery(id));
      assertRecords(
        records,
        `conversation ${id} (${caseName}) in the last ${fixtureLookback()} — ` +
          `the fixtures may not have been seeded, or the case was renamed upstream`,
      );
      targetTrace.set(caseName, String(records[0]!['trace.id']));
    }
  });

  it('flags the toxic conversation and passes the clean one', async () => {
    // Spread the baseline's own scope rather than replacing the block: the
    // overrides argument is a shallow merge, so passing a bare `scope` would
    // drop the spanFields mappings and show up as the judge scoring against a
    // missing system prompt rather than as an error.
    const base = baselineConfig(judge!);
    const config = {
      ...base,
      scope: {
        ...base.scope,
        // FIXTURE_SERVICE_NAME rather than runService(): this assertion depends
        // on the fixtures' actual content, so E2E_RUN_SERVICE must not be able
        // to point it at an unrelated tenant's traffic.
        service: FIXTURE_SERVICE_NAME,
        // sampling inherited from base.scope: uncapped 'latest', so this run
        // scores every fixture span in the lookback window, not a fixed count.
      },
    };

    const result = await runCli(['run', '--ci'], {
      configYaml: toConfigFile(config),
      env: baselineEnv(judge!),
      timeoutMs: 300_000,
    });

    assertExitCode(result, 0);
    const ci = parseJsonStdout(result) as {
      runId: string;
      errors: number;
      errorSamples: string[];
      resultsWritten: number;
    };

    // Guards the same vacuity as run.e2e.test.ts: `run` exits 0 on zero spans,
    // so without this an unseeded tenant would sail past every assertion below.
    expect(
      ci.resultsWritten,
      'the run wrote no results — check the fixtures were seeded',
    ).toBeGreaterThan(0);

    // A judge that errored on every span still exits 0 in --ci, so a wrong
    // verdict and a judge that never ran would otherwise look the same here.
    expect(ci.errors, `judge errors: ${JSON.stringify(ci.errorSamples)}`).toBe(0);

    // spec_id, not name: the bizevent writes the evaluator's *display* name
    // ("Toxicity") into gen_ai.evaluation.name and its id into
    // gen_ai.evaluation.spec_id (dt-eval-cli/src/dt/bizevent.ts:54,57 —
    // metricName vs metricId). DQL `==` is case-sensitive, so filtering the
    // name for "toxicity" matches nothing at all.
    //
    // Waits for the run's own resultsWritten rather than the two records we
    // care about: bizevent ingestion is not atomic, so stopping at 2 would
    // return an arbitrary early slice that very likely does not contain the two
    // target traces — and would then fail claiming the sample was too small.
    //
    // That equivalence holds only because the baseline enables exactly one
    // metric (`metrics.enabled: ['toxicity']` in src/config.ts): resultsWritten
    // counts every metric's records, while this query filters to toxicity. Add a
    // second metric to the baseline and this poll becomes unsatisfiable — it
    // burns its full 120s and then returns a partial slice.
    const records = await client.pollUntilRecords(
      `fetch bizevents, from:now() - 30m
| filter event.type == "gen_ai.evaluation.result"
| filter dt.eval.run_id == "${ci.runId}"
| filter gen_ai.evaluation.spec_id == "toxicity"
| fields trace_id, gen_ai.evaluation.score.label`,
      { timeoutMs: 120_000, intervalMs: 10_000, minRecords: ci.resultsWritten },
    );

    const labelByTrace = new Map(
      records.map((r) => [String(r['trace_id']), String(r['gen_ai.evaluation.score.label'])]),
    );

    for (const { caseName, expected } of VERDICT_CASES) {
      const traceId = targetTrace.get(caseName)!;
      const label = labelByTrace.get(traceId);

      // Distinguish "not scored" from "scored wrongly" — the first points at a
      // race (the beforeAll poll found the trace, but the run's own fetch ran
      // against a different tenant state) rather than a regression in dt-evals,
      // since sampling is uncapped and should score everything beforeAll saw.
      expect(
        label,
        `${caseName} (trace ${traceId}) has no toxicity verdict in run ${ci.runId}. ` +
          `The run scored ${records.length} spans but missed this trace — check for a ` +
          `race between the beforeAll poll and the run's own fetch.`,
      ).toBeDefined();

      expect(label, `${caseName} should be judged "${expected}"`).toBe(expected);
    }
    // 600s, not the 420s that exactly equals runCli 300s + poll 120s. Zero
    // headroom is a trap here: pollUntilRecords checks its deadline only after
    // execute() returns, so a query started just under the wire can add a full
    // HTTP timeout on top — and overshooting turns a precise failure message
    // into a bare "Test timed out", the least useful output the suite can give.
  }, 600_000);
});
