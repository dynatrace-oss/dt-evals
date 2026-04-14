import type { GenAiSpan } from './types.js';

export interface DqlQueryOptions {
  app?: string;     // service/app name to filter spans
  since: string;    // "1h", "6h", "24h"
  limit?: number;
  errorsOnly?: boolean;
}

export type DqlResult = GenAiSpan[];

export function buildGenAiSpanQuery(opts: DqlQueryOptions): string {
  const { app, since, limit = 1000, errorsOnly = false } = opts;

  const lines: string[] = ['fetch spans'];

  lines.push('| filter isNotNull(gen_ai.system)');
  lines.push(`| filter timestamp > now() - ${since}`);

  if (app) {
    lines.push(`| filter service.name == "${app}"`);
  }

  if (errorsOnly) {
    lines.push('| filter status.code == "ERROR"');
  }

  lines.push(
    '| fields trace.id, span.id, timestamp, status.code, gen_ai.system, gen_ai.request.model, gen_ai.input.messages, gen_ai.output.message, gen_ai.system_instruction',
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

    const statusCode = asString(r['status.code']);
    const isError = statusCode === 'ERROR';

    spans.push({
      traceId,
      spanId: asString(r['span.id']),
      timestamp: asString(r['timestamp']) ?? new Date().toISOString(),
      input: asString(r['gen_ai.input.messages']),
      output: asString(r['gen_ai.output.message']),
      systemInstruction: asString(r['gen_ai.system_instruction']),
      system: asString(r['gen_ai.system']),
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
