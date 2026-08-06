/**
 * The cross-repo contract between dt-evals and the fixture dataset.
 *
 * The fixtures live in `dynatrace-oss/dynatrace-ai-agent-instrumentation-examples`
 * and are seeded by that repo, not by this suite. Everything dt-evals does with
 * them depends on their shape, so this file checks that shape directly — no CLI,
 * no judge, no spend. It runs before the `validate` and `run` suites on purpose:
 * when a contract has moved, every downstream failure is a symptom, and knowing
 * that here saves debugging the wrong layer.
 *
 * Each assertion names the dt-evals knob that resolves a mismatch, so a red run
 * points at the fix rather than just the problem.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DynatraceClient, type DqlRecord } from '../src/dynatrace.js';
import { assertRecords, redactSecrets } from '../src/assert.js';
import { e2eEnabled, tenant } from '../src/env.js';
import {
  FIXTURE_ATTRIBUTES,
  FIXTURE_OPERATION_NAME,
  FIXTURE_SERVICE_NAME,
  PINNED_CONVERSATION_IDS,
  conversationId,
  fixtureLookback,
} from '../src/fixtures.js';

/**
 * Why a missing fixture span is usually not a dt-evals problem.
 *
 * Ordered by observed likelihood. Pointing at the wrong tenant is first because
 * it is the common mistake: the fixtures are seeded by another repo's CI, so
 * `DT_APPS_ENDPOINT` has to name *that* tenant, not whichever one a developer
 * normally runs dt-evals against.
 *
 * Second: check the `dt-evals-fixtures-opentelemetry` job specifically, not the
 * nightly's overall conclusion. That workflow runs ~20 suites and is frequently
 * red for unrelated ones while ours passes, so the overall result is a poor
 * proxy for whether seeding happened.
 */
function seedingHint(): string {
  // Redacted: this string is thrown as an assertion message, so it reaches the
  // Actions log of a public repo, and it names the tenant host.
  return redactSecrets([
    `no "${FIXTURE_SERVICE_NAME}" spans in the last ${fixtureLookback()} on ${tenant().appsEndpoint}.`,
    `This suite does not seed — the fixtures app in dynatrace-ai-agent-instrumentation-examples does.`,
    `Check, in order:`,
    `  1. DT_APPS_ENDPOINT points at the tenant that repo's CI seeds (not your usual dt-evals tenant);`,
    `  2. its "dt-evals-fixtures-opentelemetry" job passed — check that job, not the nightly's overall`,
    `     conclusion, which is often red for unrelated suites;`,
    `  3. E2E_FIXTURE_LOOKBACK covers the gap since the last seeding run (default 24h).`,
  ].join('\n'));
}

// The conversation-id derivation needs no tenant, so it is checked unconditionally.
// A drift here is a code bug in this suite; the tenant-backed cases below cannot
// be trusted until it passes.
describe('conversation id derivation', () => {
  it('reproduces the ids the fixtures compute with uuid5', () => {
    for (const [caseName, expected] of Object.entries(PINNED_CONVERSATION_IDS)) {
      expect(conversationId(caseName), `conversation id for ${caseName}`).toBe(expected);
    }
  });
});

describe.skipIf(!e2eEnabled())('fixture span contract', () => {
  let client: DynatraceClient;
  let attributeCounts: DqlRecord;

  beforeAll(async () => {
    const { appsEndpoint, apiToken } = tenant();
    client = new DynatraceClient(appsEndpoint, apiToken);

    // One aggregate query answers every attribute question below. Counting with
    // countIf rather than sampling a single span means a partially-correct
    // dataset (say, the mapping present on only some cases) cannot pass by luck.
    const records = await client.execute(`
fetch spans, from:now() - ${fixtureLookback()}
| filter service.name == "${FIXTURE_SERVICE_NAME}"
| summarize
    total = count(),
    provider = countIf(isNotNull(${FIXTURE_ATTRIBUTES.provider})),
    legacySystem = countIf(isNotNull(gen_ai.system)),
    input = countIf(isNotNull(${FIXTURE_ATTRIBUTES.input})),
    output = countIf(isNotNull(${FIXTURE_ATTRIBUTES.output})),
    systemInstructionsPlural = countIf(isNotNull(${FIXTURE_ATTRIBUTES.systemInstruction})),
    systemInstructionSingular = countIf(isNotNull(gen_ai.system_instruction)),
    context = countIf(isNotNull(${FIXTURE_ATTRIBUTES.context})),
    reference = countIf(isNotNull(${FIXTURE_ATTRIBUTES.reference})),
    conversation = countIf(isNotNull(${FIXTURE_ATTRIBUTES.conversationId}))`);

    assertRecords(records, `fixture spans — ${seedingHint()}`);
    attributeCounts = records[0]!;

    // Fail the whole suite here rather than letting each attribute test fail on
    // its own. `summarize` without `by:` always returns one record, so an empty
    // dataset yields total=0 and every count below is legitimately zero — which
    // would report four confusing symptoms ("no spans carry gen_ai.context")
    // instead of the one real cause. The lookback window doubles as the freshness
    // contract: spans older than it are excluded by the query, so stale data
    // stops the suite here instead of being asserted against.
    if (Number(attributeCounts['total'] ?? 0) === 0) throw new Error(seedingHint());
  });

  /** Read an aggregate count. DQL returns longs as strings. */
  const count = (field: string): number => Number(attributeCounts[field] ?? 0);

  it('identifies its provider in the form the CLI filters on', () => {
    // dt-eval-cli/src/dt/dql.ts:89 keeps a span when either gen_ai.system or
    // gen_ai.provider.name is set. The fixtures set only the latter — the model
    // is a fake, so vendor detection falls back to the framework ("langchain").
    expect(count('provider')).toBe(count('total'));
    expect(count('legacySystem')).toBe(0);
  });

  it('emits message content under the attributes the CLI reads by default', () => {
    // Matches DEFAULT_INPUT_FIELDS / DEFAULT_OUTPUT_FIELDS in
    // dt-eval-cli/src/dt/dql.ts:26-27, so no spanFields mapping is needed here.
    // parseSpanResults drops any span lacking usable input or output, which
    // would silently shrink every run.
    expect(count('input')).toBe(count('total'));
    expect(count('output')).toBe(count('total'));
  });

  it('emits the system prompt under the plural attribute name', () => {
    // The fixtures emit gen_ai.system_instructions; the CLI's default candidate
    // is the singular gen_ai.system_instruction (dt-eval-cli/src/dt/dql.ts:29).
    // Config fix: scope.spanFields.systemInstruction: gen_ai.system_instructions
    expect(
      count('systemInstructionsPlural'),
      'fixtures should emit the plural gen_ai.system_instructions',
    ).toBe(count('total'));
    expect(
      count('systemInstructionSingular'),
      'if the singular form appears, the spanFields mapping may no longer be needed',
    ).toBe(0);
  });

  it('emits grounding context for the evaluators that need it', () => {
    // gen_ai.context / gen_ai.reference are non-semconv attributes that exist
    // only for dt-evals, on the grounding cases (faithfulness, hallucination,
    // context-relevance, summarization-quality) rather than on every span.
    // Config fix: scope.spanFields.context: gen_ai.context
    expect(count('context'), 'no spans carry gen_ai.context').toBeGreaterThan(0);
    expect(count('context')).toBeLessThan(count('total'));
    expect(count('reference'), 'no spans carry gen_ai.reference').toBeGreaterThan(0);
  });

  it('uses an operation name the CLI already keeps by default', async () => {
    // The sharpest failure mode available: dt-eval-cli filters on
    // ['chat','text_completion','generate_content'] in both DQL
    // (src/dt/dql.ts:93) and the parser net (filterSpansByOperationName). An
    // operation name outside that list drops *every* fixture span and a run
    // reports "no data" rather than an error.
    // Config fix if this ever changes: scope.operationNames: [] to disable the filter.
    const records = await client.execute(`
fetch spans, from:now() - ${fixtureLookback()}
| filter service.name == "${FIXTURE_SERVICE_NAME}"
| summarize spans = count(), by:{${FIXTURE_ATTRIBUTES.operationName}}`);

    // Null groups are ignored on purpose. The query groups every span in the
    // service, not just GenAI ones, so a stray non-GenAI span would add a null
    // group — harmless, because the CLI's own fetch already requires
    // gen_ai.system or gen_ai.provider.name (dql.ts:89). What must hold is that
    // no *other* operation name appears, since anything outside the keep-list
    // silently drops those spans from every run.
    const names = records
      .map((r) => r[FIXTURE_ATTRIBUTES.operationName])
      .filter((name) => name !== null && name !== undefined);

    expect([...new Set(names)].sort()).toEqual([FIXTURE_OPERATION_NAME]);
  });

  it('emits one trace per turn, tied together by conversation id', async () => {
    // This asserts the fixtures' intended shape, not a defect: the design doc
    // specifies one span per turn, "each its own root span in its own trace",
    // all sharing a gen_ai.conversation.id. So the expectation below is stable
    // and should keep holding.
    //
    // What it does *not* cover is the dt-evals side of the same contract:
    // buildGenAiSpanQuery selects trace.id and never gen_ai.conversation.id
    // (dt-eval-cli/src/dt/dql.ts:124-138), so dt-evals sees N single-turn
    // conversations where the fixture intends one N-turn thread. That is a
    // product gap, tracked separately and described in the README — it is not
    // something this assertion can catch, and reading it as a tripwire for the
    // gap would be a mistake.
    const multiTurnCase = 'toxicity-hhrlhf-1065-pass';
    const id = conversationId(multiTurnCase);

    const records = await client.execute(`
fetch spans, from:now() - ${fixtureLookback()}
| filter service.name == "${FIXTURE_SERVICE_NAME}"
| filter ${FIXTURE_ATTRIBUTES.conversationId} == "${id}"
| summarize turns = count(), traces = countDistinctExact(trace.id)`);

    assertRecords(records, `conversation ${id} (${multiTurnCase})`);
    const turns = Number(records[0]!['turns'] ?? 0);
    const traces = Number(records[0]!['traces'] ?? 0);

    expect(turns, `no turns found for ${multiTurnCase}`).toBeGreaterThan(0);
    expect(
      traces,
      'each turn is expected to be its own trace — if this now equals 1, the fixture app ' +
        'changed to a single-trace shape and the design doc needs updating with it',
    ).toBe(turns);
  });
});
