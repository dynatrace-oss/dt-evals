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
const DEFAULT_OUTPUT_FIELDS = ['gen_ai.output.message', 'gen_ai.completion.0.content'];
const DEFAULT_SYSTEM_INSTRUCTION_FIELDS = ['gen_ai.system_instruction'];
const DEFAULT_MODEL_FIELDS = ['gen_ai.request.model'];

interface ResolvedFields {
  input: string[];
  output: string[];
  systemInstruction: string[];
  model: string[];
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

  const lines: string[] = ['fetch spans'];

  // Support both OTel GenAI semconv (gen_ai.system) and OpenLLMetry (gen_ai.provider.name)
  lines.push('| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)');

  // Spans use start_time, not timestamp
  lines.push(`| filter start_time > now() - ${since}`);

  if (app) {
    // Match by service.name only — `dt.smartscape.service` holds an entity
    // ID (e.g. `SERVICE-1A2B…`), not a service name, so comparing it to a
    // string raises a SMARTSCAPEID_TO_STRING_COMPARISON warning from Grail
    // and matches nothing.
    lines.push(`| filter service.name == "${app}"`);
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
 * value. Handles strings, numbers, booleans, and JSON-encodable objects.
 */
function pickFirst(record: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return undefined;
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

    let input = pickFirst(r, fields.input);
    let systemInstruction = pickFirst(r, fields.systemInstruction);
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

    const output = pickFirst(r, fields.output);

    // Skip spans with no usable input or output
    if (!input || !output) continue;

    const statusCode = asString(r['status.code']);

    spans.push({
      traceId,
      spanId: asString(r['span.id']),
      timestamp: asString(r['start_time']) ?? new Date().toISOString(),
      input,
      output,
      systemInstruction,
      userPrompt,
      // gen_ai.system (OTel) or gen_ai.provider.name (OpenLLMetry)
      system: asString(r['gen_ai.system']) ?? asString(r['gen_ai.provider.name']),
      requestModel: pickFirst(r, fields.model),
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
