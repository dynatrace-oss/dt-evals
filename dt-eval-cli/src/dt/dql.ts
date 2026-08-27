import type { GenAiSpan } from './types.js';
import type { SpanFieldsMap } from '../config/schema.js';
import { toCandidateList } from '../config/schema.js';
import { DEFAULT_OPERATION_NAMES } from '../config/defaults.js';

export interface DqlQueryOptions {
  app?: string;     // service/app name to filter spans
  since: string;    // "1h", "6h", "24h"
  limit?: number;
  errorsOnly?: boolean;
  /** Custom span attribute candidates. Tried before built-in defaults. */
  spanFields?: SpanFieldsMap;
  /** GenAI operation names to keep. Empty array disables this filter. */
  operationNames?: string[];
  mode?: "span" | "trajectory";
  maxConversations?: number;
}

export type DqlResult = GenAiSpan[];

// Number of prompt slots to probe for the OpenLLMetry convention
// (gen_ai.prompt.0.content, gen_ai.prompt.1.content, ...)
const PROMPT_SLOTS = 3;

const TRAJECTORY_SPANS_PER_CONVERSATION = 20;
const DEFAULT_MAX_CONVERSATIONS = 200;
const DEFAULT_MAX_MESSAGES = 50;

// Built-in candidate attribute lists per canonical field. User-supplied
// candidates are prepended to these so the user's choice wins, but the
// defaults remain as a fallback.
const DEFAULT_INPUT_FIELDS = ['gen_ai.input.messages'];
const DEFAULT_OUTPUT_FIELDS = ['gen_ai.output.messages', 'gen_ai.completion.0.content'];
const DEFAULT_CONTEXT_FIELDS: string[] = [];
const DEFAULT_SYSTEM_INSTRUCTION_FIELDS = ['gen_ai.system_instruction'];
const DEFAULT_MODEL_FIELDS = ['gen_ai.request.model'];

interface ResolvedFields {
  input: string[];
  output: string[];
  context: string[];
  systemInstruction: string[];
  model: string[];
}

interface FieldMatch {
  key: string;
  value: string;
}

function resolveFields(spanFields: SpanFieldsMap | undefined): ResolvedFields {
  return {
    input: [...toCandidateList(spanFields?.input), ...DEFAULT_INPUT_FIELDS],
    output: [...toCandidateList(spanFields?.output), ...DEFAULT_OUTPUT_FIELDS],
    context: [...toCandidateList(spanFields?.context), ...DEFAULT_CONTEXT_FIELDS],
    systemInstruction: [...toCandidateList(spanFields?.systemInstruction), ...DEFAULT_SYSTEM_INSTRUCTION_FIELDS],
    model: [...toCandidateList(spanFields?.model), ...DEFAULT_MODEL_FIELDS],
  };
}

function dqlStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Resolve the effective operation-name keep-list, applying the default when unset and
 * trimming each entry so a stray-whitespace config value (e.g. `" chat "`) still matches
 * the untrimmed operation name on real spans, in both the DQL filter and the parser net.
 */
export function resolveOperationNames(operationNames?: string[]): string[] {
  return (operationNames ?? DEFAULT_OPERATION_NAMES).map(name => name.trim());
}

/**
 * Parser-side safety net mirroring the DQL operation-name filter: keep only spans
 * whose gen_ai.operation.name is in the keep-list. An empty list disables the filter.
 */
export function filterSpansByOperationName(spans: GenAiSpan[], operationNames?: string[]): GenAiSpan[] {
  const keep = resolveOperationNames(operationNames);
  if (keep.length === 0) return spans;
  const keepSet = new Set(keep);
  return spans.filter(span => span.operationName !== undefined && keepSet.has(span.operationName));
}

export function buildGenAiSpanQuery(opts: DqlQueryOptions): string {
  const { app, since, limit = 1000, errorsOnly = false, spanFields, mode, maxConversations = DEFAULT_MAX_CONVERSATIONS } = opts;
  const operationNames = resolveOperationNames(opts.operationNames);
  const fields = resolveFields(spanFields);
  const isTrajectory = mode === 'trajectory';

  // Use explicit from:/to: timeframe — a filter alone leaves Grail's default
  // ~2h analysis window in effect even when the filter asks for longer.
  const lines: string[] = [`fetch spans, from:now() - ${since}, to:now()`];

  // Support both OTel GenAI semconv (gen_ai.system) and OpenLLMetry (gen_ai.provider.name)
  lines.push('| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)');

  if (operationNames.length > 0) {
    const names = operationNames.map(dqlStringLiteral).join(', ');
    lines.push(`| filter in(gen_ai.operation.name, array(${names}))`);
  }

  if (app) {
    // Match by either service.name (OTel GenAI semconv) or dt.service.name
    // (Dynatrace semantic dictionary). Both names appear on the same span
    // depending on the emitter; checking both improves match coverage.
    //
    // `dt.smartscape.service` is intentionally not in this list — it stores
    // a smartscape entity ID (e.g. SERVICE-1A2B…), not a service name, and
    // `toSmartscapeId()` is a *cast* function (string → smartscape-ID type)
    // rather than a name-to-ID resolver. Resolving a service name to its
    // smartscape ID would require a join against the entity table.
    lines.push(
      `| filter service.name == "${app}"` +
      ` or dt.service.name == "${app}"`,
    );
  }

  if (errorsOnly) {
    lines.push('| filter status.code == "ERROR"');
  }

  // Prompt slots are needed for both default OpenLLMetry parsing and for the
  // synthetic `userPrompt` extraction, so always include them.
  const promptFields = Array.from({ length: PROMPT_SLOTS }, (_, i) =>
    `gen_ai.prompt.${i}.content, gen_ai.prompt.${i}.role`,
  ).join(', ');

  // Build a deduplicated field list. `gen_ai.system` and `gen_ai.provider.name`
  // are needed for the system filter; the rest are built-in + user candidates.
  const fieldSet = new Set<string>([
    'trace.id',
    'span.id',
    'start_time',
    'end_time',
    'status.code',
    'gen_ai.operation.name',
    'gen_ai.system',
    'gen_ai.provider.name',
    'gen_ai.response.model',
    'gen_ai.agent.name',
    ...fields.input,
    ...fields.output,
    ...fields.context,
    ...fields.systemInstruction,
    ...fields.model,
  ]);
  if (isTrajectory) {
    fieldSet.add('gen_ai.conversation.id');
    fieldSet.add('gen_ai.response.finish_reasons');
  }
  const baseFields = [...fieldSet].join(', ');

  lines.push(`| fields ${baseFields}, ${promptFields}`);
  lines.push(isTrajectory ? '| sort end_time desc' : '| sort start_time desc');
  lines.push(isTrajectory ? `| limit ${maxConversations * TRAJECTORY_SPANS_PER_CONVERSATION}` : `| limit ${limit}`);

  return lines.join('\n');
}

export interface ParseSpanOptions {
  spanFields?: SpanFieldsMap;
  mode?: "span" | "trajectory";
  keepPartTypes?: string[];
  maxMessages?: number;
}

/**
 * Walk a candidate attribute list and return the first non-empty stringified
 * value together with its source key. Handles strings, numbers, booleans,
 * and JSON-encodable objects.
 */
function pickFirstMatch(record: Record<string, unknown>, candidates: string[]): FieldMatch | undefined {
  for (const key of candidates) {
    const value = asString(record[key]);
    if (value) return { key, value };
  }
  return undefined;
}

/**
 * Newer OTel GenAI emitters serialize the full conversation as a JSON array
 * under `gen_ai.input.messages` / `gen_ai.output.messages`, e.g.
 *   [{"role":"system","parts":[{"type":"text","content":"You are…"}]},
 *    {"role":"user","parts":[{"type":"text","content":"hello"}]}]
 * — the system + user + assistant turns are inlined rather than split across
 * separate prompt slots. Parsing this lets the runner recover the real system
 * prompt and latest user message from structured chat payloads.
 *
 * Returns the extracted system / user / assistant content when the input is
 * a valid JSON array of role-tagged messages; otherwise `undefined` so the
 * caller falls through to the default treatment.
 */
function extractRolesFromJsonMessages(value: string | undefined):
  | { system?: string; user?: string; assistant?: string }
  | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { messages?: unknown[] })?.messages)
      ? (parsed as { messages: unknown[] }).messages
      : undefined;
  if (!arr) return undefined;

  const out: { system?: string; user?: string; assistant?: string } = {};
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const m = item as { role?: unknown; content?: unknown; parts?: unknown };
    const role = typeof m.role === 'string' ? m.role : undefined;
    if (!role) continue;
    let content: string | undefined;
    if (typeof m.content === 'string') {
      content = m.content;
    } else if (Array.isArray(m.parts)) {
      // OTel GenAI multimodal: { parts: [{type:"text", content:"…"}, …] }
      const text: string[] = [];
      for (const p of m.parts) {
        if (p && typeof p === 'object') {
          const pp = p as { content?: unknown; text?: unknown };
          if (typeof pp.content === 'string') text.push(pp.content);
          else if (typeof pp.text === 'string') text.push(pp.text);
        }
      }
      if (text.length) content = text.join('\n');
    } else if (m.content !== undefined && m.content !== null) {
      content = JSON.stringify(m.content);
    }
    if (!content) continue;
    if (role === 'system') out.system ??= content;
    else if (role === 'user') out.user = content; // last wins
    else if (role === 'assistant') out.assistant = content; // last wins
  }
  return out;
}

const DEFAULT_KEEP_PART_TYPES = ['text', 'tool_call', 'tool_call_response'];

function extractFullHistory(raw: string, keepPartTypes?: string[], maxMessages = DEFAULT_MAX_MESSAGES): string | null {
  try {
    const messages = JSON.parse(raw);
    if (!Array.isArray(messages)) return null;
    const keep = new Set(keepPartTypes ?? DEFAULT_KEEP_PART_TYPES);
    let msgs = messages
      .map((msg: { role: string; parts?: Array<{ type?: string; content?: unknown; text?: unknown }>; content?: unknown }) => {
        if (!Array.isArray(msg.parts)) return msg;
        const parts = msg.parts.filter((p) => !p.type || keep.has(p.type));
        return { ...msg, parts };
      })
      .filter((msg) => {
        if (!Array.isArray(msg.parts)) return true;
        return msg.parts.length > 0;
      });
    if (msgs.length > maxMessages) msgs = msgs.slice(msgs.length - maxMessages);
    return JSON.stringify(msgs);
  } catch {
    return null;
  }
}

export function parseSpanResults(
  records: unknown[],
  options: ParseSpanOptions = {},
): GenAiSpan[] {
  const fields = resolveFields(options.spanFields);
  const spans: GenAiSpan[] = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;

    const r = record as Record<string, unknown>;
    const traceId = asString(r['trace.id']);
    if (!traceId) continue;

    const inputMatch = pickFirstMatch(r, fields.input);
    let input = inputMatch?.value;
    const context = pickFirstMatch(r, fields.context)?.value;
    let systemInstruction = pickFirstMatch(r, fields.systemInstruction)?.value;
    let userPrompt: string | undefined;

    // Walk OpenLLMetry prompt slots: collect user-role content into userPrompt,
    // and reconstruct a joined `input` if no canonical input candidate matched.
    const messages: string[] = [];
    for (let i = 0; i < PROMPT_SLOTS; i++) {
      const content = asString(r[`gen_ai.prompt.${i}.content`]);
      const role = asString(r[`gen_ai.prompt.${i}.role`]);
      if (!content) continue;
      if (role === 'system') {
        systemInstruction ??= content;
      } else {
        if (role === 'user') {
          // last user-role slot wins
          userPrompt = content;
        }
        messages.push(role ? `${role}: ${content}` : content);
      }
    }
    if (!input && messages.length > 0) {
      input = messages.join('\n');
    }

    // OTel GenAI evolved form: input is a JSON array of role-tagged messages
    // (system + user + …) inlined under one attribute. Extract the system
    // role into systemInstruction and the user role into userPrompt so
    // context-needing metrics work and per-metric input routing to
    // `userPrompt` doesn't fall back to the joined transcript.
    const inputRoles = extractRolesFromJsonMessages(input);
    if (inputRoles) {
      systemInstruction ??= inputRoles.system;
      userPrompt ??= inputRoles.user;
      if (inputMatch?.key === DEFAULT_INPUT_FIELDS[0]) {
        if (options.mode === 'trajectory' && input) {
          const filtered = extractFullHistory(input, options.keepPartTypes, options.maxMessages);
          if (filtered && filtered !== '[]') input = filtered;
        } else if (inputRoles.user) {
          input = inputRoles.user;
        }
      }
    }

    let output = pickFirstMatch(r, fields.output)?.value;
    // Same shape on the output side: `gen_ai.output.messages` may be a JSON
    // array of one or more {role: "assistant", …} messages. Flatten to text.
    const outputRoles = extractRolesFromJsonMessages(output);
    if (outputRoles?.assistant) {
      output = outputRoles.assistant;
    }

    // Skip spans with no usable input or output
    if (!input || !output) continue;

    const statusCode = asString(r['status.code']);

    spans.push({
      traceId,
      spanId: asString(r['span.id']),
      startTime: asString(r['start_time']),
      endTime: asString(r['end_time']),
      input,
      output,
      context,
      systemInstruction,
      userPrompt,
      // gen_ai.system (OTel) or gen_ai.provider.name (OpenLLMetry)
      system: asString(r['gen_ai.system']) ?? asString(r['gen_ai.provider.name']),
      operationName: asString(r['gen_ai.operation.name']),
      requestModel: pickFirstMatch(r, fields.model)?.value,
      responseModel: asString(r['gen_ai.response.model']),
      agentName: asString(r['gen_ai.agent.name']),
      isError: statusCode === 'ERROR' || undefined,
      conversationId: asString(r['gen_ai.conversation.id']),
      finishReasons: asString(r['gen_ai.response.finish_reasons']),
    });
  }

  return spans;
}

/**
 * Group spans by conversationId (falling back to traceId), then select one
 * representative span per group. Prefers spans with a "stop" finish reason;
 * among ties, picks the latest by endTime (or startTime as fallback).
 * Returns at most `maxConversations` spans (default 200).
 *
 * Assumes the selected span's gen_ai.input.messages carries the full conversation
 * history (holds for stateless APIs that re-send history each call; breaks for
 * stateful APIs like the Responses API with previous_response_id).
 */
export function selectTrajectorySpans(spans: GenAiSpan[], maxConversations = DEFAULT_MAX_CONVERSATIONS): GenAiSpan[] {
  const groups = new Map<string, GenAiSpan[]>();
  for (const span of spans) {
    const key = span.conversationId ?? span.traceId;
    const group = groups.get(key);
    if (group) {
      group.push(span);
    } else {
      groups.set(key, [span]);
    }
  }

  const selected: GenAiSpan[] = [];
  for (const group of groups.values()) {
    const best = group.reduce((a, b) => {
      const aStop = a.finishReasons?.toLowerCase().includes('stop') ?? false;
      const bStop = b.finishReasons?.toLowerCase().includes('stop') ?? false;
      if (aStop !== bStop) return aStop ? a : b;
      const ms = (s: GenAiSpan) => new Date(s.endTime ?? s.startTime ?? 0).getTime();
      if (!a.endTime && !a.startTime) return b;
      if (!b.endTime && !b.startTime) return a;
      return ms(a) >= ms(b) ? a : b;
    });
    selected.push(best);
    // groups are in first-seen order; cap is best-effort, not strictly most-recent-N
    if (selected.length >= maxConversations) break;
  }
  return selected;
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return undefined;
}
