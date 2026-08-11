/**
 * Does the evaluation actually work? Every other `run` assertion is
 * structural and can't fail on a *wrong* verdict. This file closes that gap:
 * the fixture dataset ships a clearly-passing and clearly-failing case per
 * evaluator, and here we check dt-evals returns that verdict — direction only,
 * never a score value, per ADR-0015.
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

    // Resolved before the run so a late-appearing span doesn't look like an evaluator failure.
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
    // Spread the baseline's own scope, since overrides is a shallow merge.
    const base = baselineConfig(judge!);
    const config = {
      ...base,
      scope: {
        ...base.scope,
        // Not runService(): this depends on fixture content, which E2E_RUN_SERVICE must not redirect.
        service: FIXTURE_SERVICE_NAME,
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

    // `run` exits 0 on zero spans, so this guards against a vacuous pass.
    expect(
      ci.resultsWritten,
      'the run wrote no results — check the fixtures were seeded',
    ).toBeGreaterThan(0);

    // A judge that errored on every span still exits 0 in --ci.
    expect(ci.errors, `judge errors: ${JSON.stringify(ci.errorSamples)}`).toBe(0);

    // spec_id, not name (DQL `==` is case-sensitive against the id, not the display name).
    // Waits for resultsWritten, not just 2, since ingestion isn't atomic and an
    // early cutoff could miss both target traces. Holds only because the
    // baseline enables exactly one metric.
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

      // "Not scored" usually means a race between beforeAll and the run's own fetch. If it
      // persists with a growing fixture set, check dql.ts's undocumented `limit 1000` with no
      // `sort` instead (README: "sampling: latest is only latest on a small service") —
      // fixtureLookback()'s cap keeps this suite under that limit today, not forever.
      expect(
        label,
        `${caseName} (trace ${traceId}) has no toxicity verdict in run ${ci.runId}. ` +
          `The run scored ${records.length} spans but missed this trace — check for a race ` +
          `between the beforeAll poll and the run's own fetch, or (if the fixture set has grown) ` +
          `dql.ts's 1000-span cap.`,
      ).toBeDefined();

      expect(label, `${caseName} should be judged "${expected}"`).toBe(expected);
    }
    // 600s, not 420s: zero headroom risks a bare "Test timed out" instead of a precise message.
  }, 600_000);
});
