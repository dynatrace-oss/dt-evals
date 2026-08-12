import { readFile } from 'node:fs/promises';

export interface RagasIngestOptions {
  runId: string;
  storeEvaluatedInput: boolean;
}

export interface RagasIngestResult {
  events: object[];
  rowsRead: number;
  metricsRead: number;
}

interface RagasRow {
  trace_id?: unknown;
  traceId?: unknown;
  user_input?: unknown;
  response?: unknown;
  scores?: unknown;
  [key: string]: unknown;
}

const NON_METRIC_FIELDS = new Set([
  'trace_id',
  'traceId',
  'span_id',
  'spanId',
  'user_input',
  'response',
  'retrieved_contexts',
  'reference_contexts',
  'reference',
  'rubric',
  'metadata',
  'scores',
]);

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function parseRows(value: unknown): RagasRow[] {
  if (Array.isArray(value)) {
    return value.map((row, index) => asRecord(row, `Ragas row ${index} must be an object`));
  }

  const document = asRecord(value, 'Ragas JSON must be an array of result rows or an object with a "scores" array');
  if (!Array.isArray(document.scores)) {
    throw new Error('Ragas JSON object must contain a "scores" array');
  }
  return document.scores.map((row, index) => asRecord(row, `Ragas score row ${index} must be an object`));
}

function metricId(name: string): string {
  return `ragas.${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function scoreLabel(score: number): 'pass' | 'fail' {
  return score >= 0.5 ? 'pass' : 'fail';
}

function readScores(row: RagasRow): Array<[string, number]> {
  const nestedScores = row.scores === undefined ? {} : asRecord(row.scores, '"scores" must be an object');
  const candidates = { ...row, ...nestedScores };

  return Object.entries(candidates)
    .filter(([name, value]) => !NON_METRIC_FIELDS.has(name) && typeof value === 'number')
    .map(([name, value]) => {
      if (!Number.isFinite(value)) {
        throw new Error(`Ragas metric "${name}" must be a finite number`);
      }
      return [name, value];
    });
}

/**
 * Convert JSON exported from `EvaluationResult.to_pandas().to_json(orient="records")`
 * (or an object containing its rows in `scores`) into Dynatrace bizevents.
 */
export async function buildRagasBizevents(
  filePath: string,
  options: RagasIngestOptions,
): Promise<RagasIngestResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch (err) {
    throw new Error(`Unable to read Ragas JSON from ${filePath}: ${(err as Error).message}`);
  }

  const rows = parseRows(parsed);
  const events: object[] = [];

  for (const [rowIndex, row] of rows.entries()) {
    const traceId = typeof row.trace_id === 'string'
      ? row.trace_id
      : typeof row.traceId === 'string'
        ? row.traceId
        : `ragas-${options.runId}-${rowIndex}`;
    const userInput = typeof row.user_input === 'string' ? row.user_input : undefined;
    const response = typeof row.response === 'string' ? row.response : undefined;

    for (const [name, score] of readScores(row)) {
      events.push({
        'event.type': 'gen_ai.evaluation.result',
        'event.provider': 'ragas',
        'trace_id': traceId,
        'timestamp': new Date().toISOString(),
        'gen_ai.evaluation.name': name,
        'gen_ai.evaluation.type': 'external',
        'gen_ai.evaluation.version': 'ragas',
        'gen_ai.evaluation.spec_id': metricId(name),
        'gen_ai.evaluation.scoring_format': score >= 0 && score <= 1 ? 'score_0_to_1' : 'numeric',
        'gen_ai.evaluation.score.value': score,
        'gen_ai.evaluation.score.label': scoreLabel(score),
        'gen_ai.evaluation.explanation': `Ragas ${name} score`,
        'gen_ai.evaluation.method': 'ragas',
        'dt.eval.run_id': options.runId,
        'gen_ai.eval.client': 'dt-eval-cli',
        ...(options.storeEvaluatedInput && userInput
          ? { 'gen_ai.evaluation.input.question': userInput }
          : {}),
        ...(options.storeEvaluatedInput && response
          ? { 'gen_ai.evaluation.input.answer': response }
          : {}),
      });
    }
  }

  if (events.length === 0) {
    throw new Error('Ragas JSON contains no numeric metric scores');
  }

  return { events, rowsRead: rows.length, metricsRead: events.length };
}
