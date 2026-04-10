import type { GenAiSpan } from './types.js';

export interface DqlQueryOptions {
  service?: string;  // service.name to filter spans
  since: string;     // "1h", "6h", "24h"
  limit?: number;
  errorsOnly?: boolean;
}

export type DqlResult = GenAiSpan[];

// Spans use the traceloop/OpenLLMetry convention:
//   gen_ai.provider.name  (not gen_ai.system)
//   gen_ai.prompt.{i}.content / .role
//   gen_ai.completion.{i}.content / .role
// We fetch up to 3 prompt slots to capture system + multi-turn inputs.
const PROMPT_SLOTS = 3;
const COMPLETION_SLOTS = 1;

export function buildGenAiSpanQuery(opts: DqlQueryOptions): string {
  const { service, since, limit = 1000, errorsOnly = false } = opts;

  const lines: string[] = ['fetch spans'];

  // Only LLM chat spans with a provider and actual completion content
  lines.push('| filter isNotNull(gen_ai.provider.name)');
  lines.push('| filter llm.request.type == "chat"');
  lines.push('| filter isNotNull(gen_ai.completion.0.content)');
  lines.push(`| filter start_time > now() - ${since}`);

  if (service) {
    lines.push(`| filter service.name == "${service}" or dt.entity.service == "${service}"`);
  }

  if (errorsOnly) {
    lines.push('| filter status.code == "ERROR" or isError == true');
  }

  const promptFields = Array.from({ length: PROMPT_SLOTS }, (_, i) =>
    `gen_ai.prompt.${i}.content, gen_ai.prompt.${i}.role`,
  ).join(', ');

  const completionFields = Array.from({ length: COMPLETION_SLOTS }, (_, i) =>
    `gen_ai.completion.${i}.content`,
  ).join(', ');

  lines.push(
    `| fields trace.id, span.id, start_time, status.code, gen_ai.provider.name, gen_ai.request.model, ${promptFields}, ${completionFields}`,
  );

  lines.push(`| limit ${limit}`);

  return lines.join('\n');
}

export function parseSpanResults(records: unknown[]): GenAiSpan[] {
  const spans: GenAiSpan[] = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;

    const r = record as Record<string, unknown>;
    const traceId = asString(r['trace.id']);
    if (!traceId) continue;

    // Build input: concatenate non-system messages as "role: content" pairs
    // Build context: extract the system message if present
    const messages: string[] = [];
    let systemInstruction: string | undefined;

    for (let i = 0; i < PROMPT_SLOTS; i++) {
      const content = asString(r[`gen_ai.prompt.${i}.content`]);
      const role = asString(r[`gen_ai.prompt.${i}.role`]);
      if (!content) continue;
      if (role === 'system') {
        systemInstruction = content;
      } else {
        messages.push(role ? `${role}: ${content}` : content);
      }
    }

    const output = asString(r['gen_ai.completion.0.content']) ?? '';
    const input = messages.join('\n') || (systemInstruction ?? '');

    // Skip spans with no usable input or output
    if (!input || !output) continue;

    const statusCode = asString(r['status.code']);
    const isError = statusCode === 'ERROR' || r['isError'] === true;

    spans.push({
      traceId,
      spanId: asString(r['span.id']),
      timestamp: asString(r['start_time']) ?? new Date().toISOString(),
      input,
      output,
      systemInstruction,
      system: asString(r['gen_ai.provider.name']),
      requestModel: asString(r['gen_ai.request.model']),
      isError: isError || undefined,
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
