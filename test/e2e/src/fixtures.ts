/**
 * The seeded fixture dataset, as this suite sees it from the tenant side. The
 * data is owned by `dynatrace-ai-agent-instrumentation-examples`; this module
 * holds only the *contract* between the two repos.
 */

import { createHash } from 'node:crypto';
import { envOr } from './env.js';

/** The `service.name` every fixture span carries — a fixed contract, not `OTEL_SERVICE_NAME`. */
export const FIXTURE_SERVICE_NAME = 'dt-evals-fixtures';

/** UUIDv5 namespace the fixtures use to derive `gen_ai.conversation.id`. */
const CONVERSATION_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

/**
 * Derive a fixture case's `gen_ai.conversation.id` (`uuid5(namespace,
 * case_name)`), recomputed rather than queried so a test can assert against a
 * *named* case. {@link PINNED_CONVERSATION_IDS} guards this implementation.
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

/** Known case name → conversation id, verified against the fixture source and a real tenant. */
export const PINNED_CONVERSATION_IDS: Record<string, string> = {
  'toxicity-hhrlhf-1065-pass': 'c8017adf-1e74-5ccc-9ed7-85735b574327',
  'toxicity-hhrlhf-1065-fail': '9937942e-896c-513f-af06-014d560eb2ce',
  'hallucination-finqa-0-pass': '6c84d4ac-eccb-56ff-b805-805a36c3790a',
};

/**
 * Cases whose verdict direction the suite asserts. Only the *last* turn is
 * discriminating, which is why {@link lastTurnTraceQuery} sorts by start time
 * rather than a turn index.
 */
export const VERDICT_CASES = [
  { metric: 'toxicity', caseName: 'toxicity-hhrlhf-1065-pass', expected: 'pass' },
  { metric: 'toxicity', caseName: 'toxicity-hhrlhf-1065-fail', expected: 'fail' },
] as const;

/** How long a seeding run must have settled before its spans are trusted, to avoid resolving a mid-flight turn as final. */
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

/** Span attributes the fixtures emit that dt-evals must be told about, verified against a live tenant. */
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

/** How far back to look for fixture spans. The suite doesn't seed, so this must cover the gap since the last seeding run. */
export function fixtureLookback(): string {
  const value = envOr('E2E_FIXTURE_LOOKBACK', '24h');
  // Validated since it's concatenated into DQL and operator-supplied.
  if (!/^\d+[smhd]$/.test(value)) {
    throw new Error(
      `E2E_FIXTURE_LOOKBACK must be a DQL duration like 24h or 7d, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * The `service.name` the `run` journeys evaluate. Overridable with
 * `E2E_RUN_SERVICE`; assertions that depend on fixture content must use
 * {@link FIXTURE_SERVICE_NAME} directly instead.
 */
export function runService(): string {
  const value = envOr('E2E_RUN_SERVICE', FIXTURE_SERVICE_NAME);
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(
      `E2E_RUN_SERVICE must be a plain service name ([A-Za-z0-9._-]), got ${JSON.stringify(value)}`,
    );
  }
  return value;
}
