import { createRequire } from 'node:module';
import type { DynatraceClient } from './client.js';
import type { GenAiSpan, BizeventPayload } from './types.js';
import type { EvalResult } from '@dynatrace-oss/dt-eval-lib';

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

/**
 * Subset of `EvalInput` from dt-eval-lib — what the judge actually saw,
 * which may differ from the raw span when per-metric inputs routing is in
 * effect (e.g. user-frustration scoring only the user-role prompt slot).
 */
export interface JudgeInputs {
  input?: string;
  output?: string;
  context?: string;
}

export function buildBizeventPayload(
  span: GenAiSpan,
  metricId: string,
  metricName: string,
  result: EvalResult,
  runId: string,
  judgeProvider: string,
  judgeModel: string,
  serviceName?: string,
  judgeInputs?: JudgeInputs,
  storeEvaluatedPrompt = false,
): BizeventPayload {
  const payload: BizeventPayload = {
    'event.type': 'gen_ai.evaluation.result',
    'event.provider': CLIENT_NAME,
    'trace_id': span.traceId,
    'timestamp': new Date().toISOString(),
    'gen_ai.evaluation.name': metricName,
    'gen_ai.evaluation.type': 'ready_made',
    'gen_ai.evaluation.version': 'v1.0',
    'gen_ai.evaluation.spec_id': metricId,
    'gen_ai.evaluation.scoring_format': scoringFormat(result.score.value),
    'gen_ai.evaluation.score.value': result.score.value,
    'gen_ai.evaluation.score.label': result.score.label,
    'gen_ai.evaluation.explanation': result.explanation.summary,
    'gen_ai.evaluation.method': 'llm_as_judge',
    'gen_ai.request.model': judgeModel,
    'gen_ai.provider.name': judgeProvider,
    ...(serviceName ? { 'dt.service.name': serviceName } : {}),
    'dt.eval.run_id': runId,
    'gen_ai.eval.client': CLIENT_NAME,
    'gen_ai.eval.client.version': CLIENT_VERSION,
    'span.start_time': span.startTime,
    'span.end_time': span.endTime,
  };

  if (span.spanId) {
    payload['span_id'] = span.spanId;
    payload['gen_ai.response.id'] = span.spanId;
  }

  if (storeEvaluatedPrompt) {
    // Record what the judge actually evaluated, not the raw span — they
    // diverge when per-metric inputs routing maps a canonical field
    // (e.g. userPrompt) onto an evaluator slot.
    payload['gen_ai.evaluation.input.question'] = judgeInputs?.input ?? span.input;
    payload['gen_ai.evaluation.input.answer'] = judgeInputs?.output ?? span.output;
    const systemPrompt = judgeInputs?.context ?? span.systemInstruction;
    if (systemPrompt) {
      payload['gen_ai.evaluation.input.system_prompt'] = systemPrompt;
    }
  }

  return payload;
}

export class BizeventWriter {
  constructor(private readonly client: DynatraceClient) {}

  async writeEvalResult(
    span: GenAiSpan,
    metricId: string,
    metricName: string,
    result: EvalResult,
    runId: string,
    judgeProvider: string,
    judgeModel: string,
    serviceName?: string,
  ): Promise<void> {
    const payload = buildBizeventPayload(span, metricId, metricName, result, runId, judgeProvider, judgeModel, serviceName);
    await this.writeBatch([payload]);
  }

  async writeBatch(payloads: BizeventPayload[]): Promise<void> {
    if (payloads.length === 0) {
      return;
    }
    await this.client.ingestBizevents(payloads as unknown as object[]);
  }
}
