import type { GenAiSpan } from './types.js';

export interface DqlQueryOptions {
  app?: string;     // service/app name to filter spans
  since: string;    // "1h", "6h", "24h"
  limit?: number;
  errorsOnly?: boolean;
}

export type DqlResult = GenAiSpan[];

// Number of prompt slots to probe for the OpenLLMetry convention
// (gen_ai.prompt.0.content, gen_ai.prompt.1.content, ...)
const PROMPT_SLOTS = 3;

export function buildGenAiSpanQuery(opts: DqlQueryOptions): string {
  const { app, since, limit = 1000, errorsOnly = false } = opts;

  const lines: string[] = ['fetch spans'];

  // Support both OTel GenAI semconv (gen_ai.system) and OpenLLMetry (gen_ai.provider.name)
  lines.push('| filter isNotNull(gen_ai.system) or isNotNull(gen_ai.provider.name)');

  // Spans use start_time, not timestamp
  lines.push(`| filter start_time > now() - ${since}`);

  if (app) {
    // Match by service.name or the entity ID alternative
    lines.push(`| filter service.name == "${app}" or dt.smartscape.service == "${app}"`);
  }

  if (errorsOnly) {
    lines.push('| filter status.code == "ERROR"');
  }

  // Fetch both OTel GenAI and OpenLLMetry field names so parseSpanResults can handle either
  const promptFields = Array.from({ length: PROMPT_SLOTS }, (_, i) =>
    `gen_ai.prompt.${i}.content, gen_ai.prompt.${i}.role`,
  ).join(', ');

  lines.push(
    `| fields trace.id, span.id, start_time, status.code,` +
    ` gen_ai.system, gen_ai.provider.name, gen_ai.request.model,` +
    ` gen_ai.input.messages, gen_ai.output.message, gen_ai.system_instruction,` +
    ` ${promptFields}, gen_ai.completion.0.content`,
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

    // OTel GenAI: gen_ai.input.messages; OpenLLMetry: gen_ai.prompt.N.content
    let input = asString(r['gen_ai.input.messages']);
    let systemInstruction = asString(r['gen_ai.system_instruction']);

    if (!input) {
      // Reconstruct from prompt slots — system role → context, user/assistant → input
      const messages: string[] = [];
      for (let i = 0; i < PROMPT_SLOTS; i++) {
        const content = asString(r[`gen_ai.prompt.${i}.content`]);
        const role = asString(r[`gen_ai.prompt.${i}.role`]);
        if (!content) continue;
        if (role === 'system') {
          systemInstruction ??= content;
        } else {
          messages.push(role ? `${role}: ${content}` : content);
        }
      }
      if (messages.length > 0) input = messages.join('\n');
    }

    // OTel GenAI: gen_ai.output.message; OpenLLMetry: gen_ai.completion.0.content
    const output =
      asString(r['gen_ai.output.message']) ??
      asString(r['gen_ai.completion.0.content']);

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
      // gen_ai.system (OTel) or gen_ai.provider.name (OpenLLMetry)
      system: asString(r['gen_ai.system']) ?? asString(r['gen_ai.provider.name']),
      requestModel: asString(r['gen_ai.request.model']),
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
