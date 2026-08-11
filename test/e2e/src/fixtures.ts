/**
 * The seeded fixture dataset, as this suite sees it from the tenant side.
 *
 * The data itself is owned by `dt-evals-fixtures/opentelemetry/` in
 * `dynatrace-oss/dynatrace-ai-agent-instrumentation-examples`. This module holds
 * only the *contract* between the two repos: the service name to filter on, how
 * a case name maps to a conversation id, and the attribute names dt-evals has to
 * read. Anything here changing means one of the two repos moved without the
 * other.
 */

import { createHash } from 'node:crypto';
import { envOr } from './env.js';

/**
 * The `service.name` every fixture span carries.
 *
 * Comes from the `service_name` field in `fixtures.json` (Traceloop's
 * `app_name`), *not* from `OTEL_SERVICE_NAME` — the fixtures README calls this a
 * fixed contract because it is what both the DQL filter and the metric lookup
 * key on.
 */
export const FIXTURE_SERVICE_NAME = 'dt-evals-fixtures';

/**
 * UUIDv5 namespace the fixtures use to derive `gen_ai.conversation.id`, copied
 * from `_CONVERSATION_NAMESPACE` in `fixtures.py:15`.
 */
const CONVERSATION_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

/**
 * Derive a fixture case's `gen_ai.conversation.id`.
 *
 * The fixtures compute `uuid5(namespace, case_name)` so multi-turn cases group
 * into one thread. Recomputing it here — rather than querying for whatever ids
 * happen to be present — is what lets a test assert something about a *named*
 * case, and makes a drift in either repo show up as a missing conversation
 * instead of as a silently different assertion.
 *
 * UUIDv5 is SHA-1 based and fully specified (RFC 4122 §4.3), so it is
 * implemented inline rather than pulling in a dependency for fifteen lines.
 * {@link PINNED_CONVERSATION_IDS} guards the implementation.
 */
export function conversationId(caseName: string): string {
  const namespaceBytes = Buffer.from(CONVERSATION_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(caseName, 'utf-8'))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  // Version 5 in the high nibble of byte 6; RFC 4122 variant in byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Known case name → conversation id, verified against both the fixture source
 * (`uuid.uuid5` in Python) and spans on a real tenant.
 *
 * Doubles as a self-check on {@link conversationId} and as a canary for the
 * fixture dataset: if a case is renamed upstream, its id changes and the
 * contract suite reports which one moved.
 */
export const PINNED_CONVERSATION_IDS: Record<string, string> = {
  'toxicity-hhrlhf-1065-pass': 'c8017adf-1e74-5ccc-9ed7-85735b574327',
  'toxicity-hhrlhf-1065-fail': '9937942e-896c-513f-af06-014d560eb2ce',
  'hallucination-finqa-0-pass': '6c84d4ac-eccb-56ff-b805-805a36c3790a',
};

/**
 * Cases whose verdict direction the suite asserts — the design doc's "a toxic
 * span gets flagged and a clean one passes" ([What we check]).
 *
 * Only the *last* turn of each case is discriminating. Both toxicity cases open
 * with the same benign turn ("What is vulgar language?") and diverge on turn 2,
 * which is why `fixtures.json` puts an explicit `expect` on that turn and not on
 * the first. Asserting the case-level `expect` against every span of the case
 * would demand a `fail` verdict for a turn that legitimately passes.
 *
 * Resolving "the last turn" is why {@link lastTurnTraceQuery} sorts by start
 * time rather than trusting a turn index: the fixtures are re-seeded on a
 * schedule, so a lookback window usually holds several runs of the same case,
 * and only the newest span per conversation is reliably its final turn.
 */
export const VERDICT_CASES = [
  { metric: 'toxicity', caseName: 'toxicity-hhrlhf-1065-pass', expected: 'pass' },
  { metric: 'toxicity', caseName: 'toxicity-hhrlhf-1065-fail', expected: 'fail' },
] as const;

/**
 * How long a seeding run must have settled before its spans are trusted.
 *
 * Without this, a seeding that is mid-flight resolves turn 1 as "the newest
 * span" because turn 2 has not landed yet. Both toxicity cases open with the
 * same benign question and only diverge on turn 2, so the judge would correctly
 * score that benign turn `pass` and the test would report "the toxic case was
 * judged pass" — an evaluator regression that never happened.
 *
 * Five minutes is comfortably longer than a seeding run and far shorter than
 * the three-hour gap the weekly schedule leaves after the upstream nightly.
 */
const SEEDING_SETTLE = '5m';

/** DQL for the newest settled span of one conversation — its final turn. */
export function lastTurnTraceQuery(conversationId: string): string {
  return [
    `fetch spans, from:now() - ${fixtureLookback()}`,
    `| filter service.name == "${FIXTURE_SERVICE_NAME}"`,
    `| filter ${FIXTURE_ATTRIBUTES.conversationId} == "${conversationId}"`,
    `| filter start_time < now() - ${SEEDING_SETTLE}`,
    `| sort start_time desc`,
    `| limit 1`,
    `| fields trace.id`,
  ].join('\n');
}

/**
 * Span attributes the fixtures emit that dt-evals must be told about.
 *
 * Verified against 96 fixture spans on a live tenant:
 *   - `gen_ai.provider.name` on all of them, `gen_ai.system` on none — the
 *     provider reads `"langchain"` because the model is a fake, which still
 *     satisfies the CLI's provider filter (`dt-eval-cli/src/dt/dql.ts:89`);
 *   - `gen_ai.input.messages` / `gen_ai.output.messages` on all of them, which
 *     match the CLI's built-in defaults with no mapping needed;
 *   - `gen_ai.system_instructions` — *plural* — on all of them, while the CLI
 *     defaults to the singular `gen_ai.system_instruction`, so this one needs a
 *     `spanFields` mapping;
 *   - `gen_ai.context` and `gen_ai.reference` on the grounding cases only; both
 *     are non-semconv attributes that exist purely for dt-evals;
 *   - `gen_ai.operation.name = "chat"` on all of them, which is already in the
 *     CLI's default keep-list (`dt-eval-cli/src/config/defaults.ts:24`), so no
 *     `scope.operationNames` override is required.
 */
export const FIXTURE_ATTRIBUTES = {
  provider: 'gen_ai.provider.name',
  input: 'gen_ai.input.messages',
  output: 'gen_ai.output.messages',
  /** Plural — the CLI's default is the singular form. */
  systemInstruction: 'gen_ai.system_instructions',
  context: 'gen_ai.context',
  reference: 'gen_ai.reference',
  conversationId: 'gen_ai.conversation.id',
  operationName: 'gen_ai.operation.name',
  model: 'gen_ai.request.model',
} as const;

/** The single `gen_ai.operation.name` value the fixtures emit. */
export const FIXTURE_OPERATION_NAME = 'chat';

/**
 * How far back to look for fixture spans.
 *
 * The suite does not seed: it consumes spans the fixtures app shipped earlier,
 * so the window has to cover the gap since the last seeding run. Override with
 * `E2E_FIXTURE_LOOKBACK` (a DQL duration such as `24h` or `7d`) when working
 * against a tenant that is seeded on a different cadence than the one CI uses.
 */
export function fixtureLookback(): string {
  const value = envOr('E2E_FIXTURE_LOOKBACK', '24h');
  // Validated because it is string-concatenated into DQL and, via
  // workflow_dispatch, is operator-supplied. Same rule the CLI applies to
  // `scope.since` (dt-eval-cli/src/config/index.ts:242), so the two cannot drift.
  if (!/^\d+[smhd]$/.test(value)) {
    throw new Error(
      `E2E_FIXTURE_LOOKBACK must be a DQL duration like 24h or 7d, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * The `service.name` the `run` journeys evaluate.
 *
 * Defaults to the fixture service, which is what CI uses. Overridable with
 * `E2E_RUN_SERVICE` because the structural `run` assertions — output shape, exit
 * codes, run log, destination round-trip — depend only on *some* GenAI spans
 * existing, not on the fixtures' specific content. That makes them runnable
 * against any tenant with GenAI traffic, which is useful when the fixture tenant
 * is not to hand.
 *
 * Assertions that *do* depend on fixture content — a toxic case being flagged, a
 * clean one passing — must use {@link FIXTURE_SERVICE_NAME} directly, not this.
 */
export function runService(): string {
  const value = envOr('E2E_RUN_SERVICE', FIXTURE_SERVICE_NAME);
  // Validated for the same reason as fixtureLookback(): it is concatenated into
  // DQL, here by the CLI itself. Less exposed — it is not a workflow input — but
  // letting the two rules drift is how one of them ends up forgotten.
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(
      `E2E_RUN_SERVICE must be a plain service name ([A-Za-z0-9._-]), got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

