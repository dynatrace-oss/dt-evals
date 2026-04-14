import { createRequire } from 'node:module';
import type { DynatraceClient } from './client.js';
import type { GenAiSpan, BizeventPayload } from './types.js';
import type { EvalResult } from 'dt-eval-lib';

declare const __CLIENT_VERSION__: string | undefined;
const CLIENT_NAME = 'dt-eval-cli';
// __CLIENT_VERSION__ is replaced at build time by tsup; fall back to package.json at runtime (tsx dev mode)
function resolveVersion(): string {
  try {
    if (typeof __CLIENT_VERSION__ !== 'undefined') return __CLIENT_VERSION__;
  } catch { /* not defined in dev/tsx */ }
  try {
    const require = createRequire(import.meta.url);
    return (require('../../package.json') as { version: string }).version;
  } catch { return 'dev'; }
}
const CLIENT_VERSION = resolveVersion();

export type { EvalResult };

function scoringFormat(scoreValue: number): string {
  return scoreValue > 1 ? 'score_1_to_5' : 'score_0_to_1';
}

export function buildBizeventPayload(
  span: GenAiSpan,
  metric: string,
  result: EvalResult,
  runId: string,
  judgeProvider: string,
  judgeModel: string,
  serviceName?: string,
): BizeventPayload {
  const payload: BizeventPayload = {
    'event.type': 'gen_ai.evaluation.result',
    'event.provider': CLIENT_NAME,
    'trace_id': span.traceId,
    'timestamp': new Date().toISOString(),
    'gen_ai.evaluation.name': metric,
    'gen_ai.evaluation.type': 'ready_made',
    'gen_ai.evaluation.version': 'v1.0',
    'gen_ai.evaluation.spec_id': `evalspec_${metric}_v1`,
    'gen_ai.evaluation.scoring_format': scoringFormat(result.score.value),
    'gen_ai.evaluation.score.value': result.score.value,
    'gen_ai.evaluation.score.label': result.score.label,
    'gen_ai.evaluation.explanation': result.explanation.summary,
    'gen_ai.evaluation.method': 'llm_as_judge',
    'gen_ai.evaluation.input.question': span.input,
    'gen_ai.evaluation.input.answer': span.output,
    'gen_ai.request.model': judgeModel,
    'gen_ai.provider.name': judgeProvider,
    ...(serviceName ? { 'dt.service.name': serviceName } : {}),
    'dt.eval.run_id': runId,
    'gen_ai.eval.client': CLIENT_NAME,
    'gen_ai.eval.client.version': CLIENT_VERSION,
  };

  if (span.spanId) {
    payload['span_id'] = span.spanId;
    payload['gen_ai.response.id'] = span.spanId;
  }

  if (span.systemInstruction) {
    payload['gen_ai.evaluation.input.system_prompt'] = span.systemInstruction;
  }

  return payload;
}

export class BizeventWriter {
  constructor(private readonly client: DynatraceClient) {}

  async writeEvalResult(
    span: GenAiSpan,
    metric: string,
    result: EvalResult,
    runId: string,
    judgeProvider: string,
    judgeModel: string,
    serviceName?: string,
  ): Promise<void> {
    const payload = buildBizeventPayload(span, metric, result, runId, judgeProvider, judgeModel, serviceName);
    await this.writeBatch([payload]);
  }

  async writeBatch(payloads: BizeventPayload[]): Promise<void> {
    if (payloads.length === 0) {
      return;
    }
    await this.client.ingestBizevents(payloads as unknown as object[]);
  }
}
