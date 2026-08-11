/**
 * The cross-repo contract between dt-evals and the fixture dataset, seeded by
 * `dynatrace-ai-agent-instrumentation-examples`, not this suite. Checks the
 * shape directly — no CLI, no judge, no spend — before `validate`/`run` run,
 * so a moved contract shows up as a symptom here rather than downstream.
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

/** Why a missing fixture span is usually not a dt-evals problem — most likely the wrong tenant, checked first. */
async function seedingHint(): Promise<string> {
  // Redacted: names the tenant host, and reaches a public Actions log.
  return redactSecrets([
    `no "${FIXTURE_SERVICE_NAME}" spans in the last ${fixtureLookback()} on ${(await tenant()).appsEndpoint}.`,
    `This suite does not seed — the fixtures app in dynatrace-ai-agent-instrumentation-examples does.`,
    `Check, in order:`,
    `  1. DT_APPS_ENDPOINT points at the tenant that repo's CI seeds (not your usual dt-evals tenant);`,
    `  2. its "dt-evals-fixtures-opentelemetry" job passed — check that job, not the nightly's overall`,
    `     conclusion, which is often red for unrelated suites;`,
    `  3. E2E_FIXTURE_LOOKBACK covers the gap since the last seeding run (default 24h).`,
  ].join('\n'));
}

// Needs no tenant, so checked unconditionally — the cases below can't be trusted until this passes.
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
    const { appsEndpoint, apiToken } = await tenant();
    client = new DynatraceClient(appsEndpoint, apiToken);

    // One aggregate query for every attribute; countIf means a partially-correct dataset can't pass by luck.
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

    assertRecords(records, `fixture spans — ${await seedingHint()}`);
    attributeCounts = records[0]!;

    // Fail here, not per-test: an empty dataset makes every count below zero too — one cause, not four symptoms.
    if (Number(attributeCounts['total'] ?? 0) === 0) throw new Error(await seedingHint());
  });

  /** Read an aggregate count. DQL returns longs as strings. */
  const count = (field: string): number => Number(attributeCounts[field] ?? 0);

  it('identifies its provider in the form the CLI filters on', () => {
    // The model is fake, so vendor detection falls back to the framework ("langchain").
    expect(count('provider')).toBe(count('total'));
    expect(count('legacySystem')).toBe(0);
  });

  it('emits message content under the attributes the CLI reads by default', () => {
    expect(count('input')).toBe(count('total'));
    expect(count('output')).toBe(count('total'));
  });

  it('emits the system prompt under the plural attribute name', () => {
    // Fixtures emit the plural form; the CLI's default candidate is singular.
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
    // Only on the grounding cases, not every span.
    expect(count('context'), 'no spans carry gen_ai.context').toBeGreaterThan(0);
    expect(count('context')).toBeLessThan(count('total'));
    expect(count('reference'), 'no spans carry gen_ai.reference').toBeGreaterThan(0);
  });

  it('uses an operation name the CLI already keeps by default', async () => {
    // A name outside the CLI's fixed keep-list drops *every* fixture span silently.
    const records = await client.execute(`
fetch spans, from:now() - ${fixtureLookback()}
| filter service.name == "${FIXTURE_SERVICE_NAME}"
| summarize spans = count(), by:{${FIXTURE_ATTRIBUTES.operationName}}`);

    // Null groups ignored — what must hold is that no *other* name appears.
    const names = records
      .map((r) => r[FIXTURE_ATTRIBUTES.operationName])
      .filter((name) => name !== null && name !== undefined);

    expect([...new Set(names)].sort()).toEqual([FIXTURE_OPERATION_NAME]);
  });

  it('emits one trace per turn, tied together by conversation id', async () => {
    // Asserts the fixtures' shape only. The CLI's own query still sees N
    // single-turn conversations rather than one N-turn thread — a known
    // product gap tracked in the README, not covered here.
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
