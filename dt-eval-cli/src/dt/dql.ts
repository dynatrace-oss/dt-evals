import type { GenAiSpan } from './types.js';
import type { SpanFieldsMap } from '../config/schema.js';
import { toCandidateList } from '../config/schema.js';

export interface DqlQueryOptions {
  app?: string;     // service/app name to filter spans
  since: string;    // "1h", "6h", "24h"
  limit?: number;
  errorsOnly?: boolean;
  /** Custom span attribute candidates. Tried before built-in defaults. */
  spanFields?: SpanFieldsMap;
}

export type DqlResult = GenAiSpan[];

// Number of prompt slots to probe for the OpenLLMetry convention
// (gen_ai.prompt.0.content, gen_ai.prompt.1.content, ...)
const PROMPT_SLOTS = 3;

// Built-in candidate attribute lists per canonical field. User-supplied
// candidates are prepended to these so the user's choice wins, but the
// defaults remain as a fallback.
const DEFAULT_INPUT_FIELDS = ['gen_ai.input.messages'];
const DEFAULT_OUTPUT_FIELDS = ['gen_ai.output.message', 'gen_ai.output.messages', 'gen_ai.completion.0.content'];
const DEFAULT_SYSTEM_INSTRUCTION_FIELDS = ['gen_ai.system_instruction'];
const DEFAULT_MODEL_FIELDS = ['gen_ai.request.model'];

interface ResolvedFields {
  input: string[];
  output: string[];
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
    systemInstruction: [...toCandidateList(spanFields?.systemInstruction), ...DEFAULT_SYSTEM_INSTRUCTION_FIELDS],
    model: [...toCandidateList(spanFields?.model), ...DEFAULT_MODEL_FIELDS],
  };
}

export function buildGenAiSpanQuery(opts: DqlQueryOptions): string {
  const { app, since, limit = 1000, errorsOnly = false, spanFields } = opts;
  const fields = resolveFields(spanFields);

  // Use explicit from:/to: timeframe — a filter alone leaves Grail's default
  // ~2h analysis window in effect even when the filter asks for longer.
  const lines: string[] = [`fetch spans, from:now() - ${since}, to:now()`];

  // Support both OTel GenAI semconv (gen_ai.system) and OpenLLMetry (gen_ai.provider.name)
  lines.push('| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)');

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
    'gen_ai.system',
    'gen_ai.provider.name',
    ...fields.input,
    ...fields.output,
    ...fields.systemInstruction,
    ...fields.model,
  ]);
  const baseFields = [...fieldSet].join(', ');

  lines.push(`| fields ${baseFields}, ${promptFields}`);
  lines.push(`| limit ${limit}`);

  return lines.join('\n');
}

export interface ParseSpanOptions {
  spanFields?: SpanFieldsMap;
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
 * separate prompt slots. Without parsing the JSON, the runner can't surface
 * `systemInstruction` (context) or `userPrompt`, so context-needing metrics
 * (faithfulness, hallucination, fluency, context-relevance) all error with
 * "Missing required fields: context" on these spans.
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
      if (inputMatch?.key === DEFAULT_INPUT_FIELDS[0] && inputRoles.user) {
        input = inputRoles.user;
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
      systemInstruction,
      userPrompt,
      // gen_ai.system (OTel) or gen_ai.provider.name (OpenLLMetry)
      system: asString(r['gen_ai.system']) ?? asString(r['gen_ai.provider.name']),
      requestModel: pickFirstMatch(r, fields.model)?.value,
      isError: statusCode === 'ERROR' || undefined,
    });
  }

  return spans;
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return undefined;
}
