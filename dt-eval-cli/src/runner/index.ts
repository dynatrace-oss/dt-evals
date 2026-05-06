import { randomUUID } from 'node:crypto';
import { evaluate, type EvalConfig, type EvalInput, type EvalResult } from '@dynatrace-oss/dt-eval-lib';
import type { DynatraceClient } from '../dt/client.js';
import type { DtEvalConfig, MetricEntry, MetricInputs, CanonicalSpanField } from '../config/schema.js';
import { metricId, metricInputs } from '../config/schema.js';
import type { GenAiSpan, BizeventPayload } from '../dt/types.js';
import { buildGenAiSpanQuery, parseSpanResults } from '../dt/dql.js';
import { BizeventWriter, buildBizeventPayload } from '../dt/bizevent.js';
import { DRIFT_METRIC_ID, runDriftDetection, buildDriftBizevents } from './drift.js';
import { applySampling } from './sampler.js';
import { maskSpan } from '../masker/index.js';
import { processBatch } from './batch.js';
import { appendRunRecord } from './checkpoint.js';
import { logger } from '../logger/index.js';

export { logger };

export interface RunOptions {
  since?: string;
  sample?: number;    // percent 0-100
  metrics?: MetricEntry[];
  dryRun?: boolean;
  ci?: boolean;
  concurrency?: number;
}

export interface RunResult {
  runId: string;
  spansEvaluated: number;
  resultsWritten: number;
  errors: number;
  errorSamples: string[];   // deduplicated sample of error messages for user display
  thresholdBreaches: Array<{ metric: string; traceId: string; score: number }>;
  durationMs: number;
}

interface EvalTask {
  span: GenAiSpan;
  metric: string;
  inputs?: MetricInputs;
}

/**
 * Resolve a canonical span field reference to the concrete string value on
 * a span. Returns undefined when the source field is not populated (e.g.
 * `userPrompt` requested but no user-role prompt slot was present).
 */
function resolveCanonicalField(span: GenAiSpan, field: CanonicalSpanField): string | undefined {
  switch (field) {
    case 'input': return span.input;
    case 'output': return span.output;
    case 'systemInstruction': return span.systemInstruction;
    case 'model': return span.requestModel;
    case 'userPrompt': return span.userPrompt;
  }
}

/** Build the EvalInput passed to dt-eval-lib, applying any per-metric routing. */
function buildEvalInput(span: GenAiSpan, inputs: MetricInputs | undefined): EvalInput {
  if (!inputs) {
    return { input: span.input, output: span.output, context: span.systemInstruction };
  }
  return {
    input: (inputs.input && resolveCanonicalField(span, inputs.input)) ?? span.input,
    output: (inputs.output && resolveCanonicalField(span, inputs.output)) ?? span.output,
    context: (inputs.context && resolveCanonicalField(span, inputs.context)) ?? span.systemInstruction,
  };
}

interface EvalTaskResult {
  span: GenAiSpan;
  metric: string;
  evalResult: EvalResult;
  /** The exact input the judge was given — may be a routed subset of span fields. */
  evalInput: EvalInput;
}

export type { EvalResult };

export async function runEvals(
  dtClient: DynatraceClient,
  evalConfig: DtEvalConfig,
  opts: RunOptions,
): Promise<RunResult> {
  const startTime = Date.now();
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomUUID().slice(0, 8)}`;

  const since = opts.since ?? evalConfig.scope.since;
  const metricEntries: MetricEntry[] = opts.metrics ?? evalConfig.metrics.enabled;
  const concurrency = opts.concurrency ?? 5;

  // 1. Fetch spans via DQL
  logger.step('Fetching spans...');
  const query = buildGenAiSpanQuery({
    app: evalConfig.scope.service,
    since,
    errorsOnly: evalConfig.scope.sampling?.strategy === 'errors-only',
    spanFields: evalConfig.scope.spanFields,
  });
  logger.debug(`DQL query:\n${query}`);

  const t0Dql = Date.now();
  const rawRecords = await dtClient.executeDql(query) as unknown[];
  logger.timing('DQL fetch', Date.now() - t0Dql, { rawRecords: (rawRecords as unknown[]).length });

  const t0Parse = Date.now();
  const allSpans = parseSpanResults(rawRecords, { spanFields: evalConfig.scope.spanFields });
  logger.timing('Parse spans', Date.now() - t0Parse, { spans: allSpans.length });

  // 2. Apply sampling
  logger.step('Applying sampling...');
  const scopeConfig = {
    ...evalConfig.scope,
    since,
    ...(opts.sample !== undefined
      ? { sampling: { ...evalConfig.scope.sampling, strategy: 'random' as const, percent: opts.sample } }
      : {}),
  };
  const t0Sample = Date.now();
  const sampledSpans = applySampling(allSpans, scopeConfig);
  logger.timing('Sampling', Date.now() - t0Sample, { sampled: sampledSpans.length, total: allSpans.length });

  // 3. Apply PII masking
  logger.step('Masking PII...');
  const t0Mask = Date.now();
  const maskedSpans = sampledSpans.map(span => maskSpan(span));
  logger.timing('PII masking', Date.now() - t0Mask, { spans: maskedSpans.length });

  // 4. Build task list (span × metric), excluding drift which runs separately
  const metricIds = metricEntries.map(metricId);
  const evalEntries = metricEntries.filter(e => metricId(e) !== DRIFT_METRIC_ID);
  const runDrift = metricIds.includes(DRIFT_METRIC_ID);

  const tasks: EvalTask[] = maskedSpans.flatMap(span =>
    evalEntries.map(entry => ({ span, metric: metricId(entry), inputs: metricInputs(entry) })),
  );

  if (opts.dryRun) {
    console.log(JSON.stringify({ runId, tasks: tasks.length, spans: maskedSpans.length, metrics: metricIds }, null, 2));
    return {
      runId,
      spansEvaluated: maskedSpans.length,
      resultsWritten: 0,
      errors: 0,
      errorSamples: [],
      thresholdBreaches: [],
      durationMs: Date.now() - startTime,
    };
  }

  // 5. Build provider config for dt-eval-lib
  const judgeProvider = evalConfig.judge.provider;
  const judgeModel = evalConfig.judge.model ?? '';

  const libConfig: EvalConfig = {
    provider: {
      provider: evalConfig.judge.provider as import('@dynatrace-oss/dt-eval-lib').Provider,
      apiKey: evalConfig.judge.apiKey,
      baseUrl: evalConfig.judge.baseUrl,
      apiVersion: evalConfig.judge.apiVersion,
      region: evalConfig.judge.region,
      secretKey: evalConfig.judge.secretKey,
      model: evalConfig.judge.model,
      timeout: evalConfig.judge.timeout,
      maxRetries: evalConfig.judge.maxRetries,
    },
  };

  // 6. Evaluate via dt-eval-lib in parallel batches
  logger.info(`Evaluating ${maskedSpans.length} spans × ${metricIds.length} metrics...`);
  const t0Eval = Date.now();
  let evalCount = 0;
  const batchResults = await processBatch<EvalTask, EvalTaskResult>(
    tasks,
    async task => {
      const t0 = Date.now();
      const input: EvalInput = buildEvalInput(task.span, task.inputs);
      const evalResult = await evaluate(task.metric, input, libConfig);
      evalCount++;
      logger.debug(`eval [${evalCount}/${tasks.length}] ${task.metric} trace=${task.span.traceId.slice(0, 8)}… ${Date.now() - t0}ms score=${evalResult.score.value}`);
      return { span: task.span, metric: task.metric, evalResult, evalInput: input };
    },
    { concurrency },
  );
  logger.timing('Eval batch', Date.now() - t0Eval, { tasks: tasks.length, concurrency });

  // 7. Collect results and errors
  const successResults: EvalTaskResult[] = [];
  let errors = 0;
  const seenErrors = new Map<string, number>(); // message → count

  for (const r of batchResults) {
    if (r.error) {
      errors++;
      const msg = r.error.message ?? String(r.error);
      seenErrors.set(msg, (seenErrors.get(msg) ?? 0) + 1);
      if (opts.ci) {
        console.error(JSON.stringify({ error: msg, metric: (r.item as EvalTask).metric }));
      }
    } else if (r.result) {
      successResults.push(r.result);
    }
  }

  // Keep the top-3 most frequent distinct error messages for surfacing to the user
  const errorSamples = [...seenErrors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([msg, count]) => count > 1 ? `${msg} (×${count})` : msg);

  // 8. Write bizevents
  logger.step('Writing bizevents...');
  const writer = new BizeventWriter(dtClient);
  const payloads: BizeventPayload[] = successResults.map(r =>
    buildBizeventPayload(r.span, r.metric, r.evalResult, runId, judgeProvider, judgeModel, evalConfig.scope.service, r.evalInput),
  );

  const t0Ingest = Date.now();
  await writer.writeBatch(payloads);
  logger.timing('Bizevent ingest', Date.now() - t0Ingest, { payloads: payloads.length });

  // 9. Run drift detection (if selected as a metric)
  if (runDrift && !opts.dryRun) {
    // Build per-metric score arrays from this run
    const currentScores: Record<string, number[]> = {};
    for (const r of successResults) {
      (currentScores[r.metric] ??= []).push(r.evalResult.score.value);
    }
    const driftResults = await runDriftDetection(
      dtClient,
      currentScores,
      evalConfig.scope.service,
      runId,
      since,
    );
    if (driftResults.length > 0) {
      const driftEvents = buildDriftBizevents(driftResults, runId, evalConfig.scope.service);
      await dtClient.ingestBizevents(driftEvents);
      logger.timing('Drift ingest', 0, { events: driftEvents.length });
    }
  }

  // 10. Check thresholds
  const thresholdBreaches: RunResult['thresholdBreaches'] = [];
  if (evalConfig.alerts?.thresholds) {
    for (const r of successResults) {
      const threshold = evalConfig.alerts.thresholds[r.metric];
      if (threshold !== undefined && r.evalResult.score.value < threshold) {
        thresholdBreaches.push({
          metric: r.metric,
          traceId: r.span.traceId,
          score: r.evalResult.score.value,
        });
      }
    }
  }

  const result: RunResult = {
    runId,
    spansEvaluated: maskedSpans.length,
    resultsWritten: payloads.length,
    errors,
    errorSamples,
    thresholdBreaches,
    durationMs: Date.now() - startTime,
  };

  logger.success(`Run complete: ${payloads.length} results written`);

  if (opts.ci) {
    console.log(JSON.stringify(result));
  }

  // 10. Append run record to checkpoint
  await appendRunRecord({
    runId: result.runId,
    timestamp: new Date().toISOString(),
    spansEvaluated: result.spansEvaluated,
    resultsWritten: result.resultsWritten,
    errors: result.errors,
    thresholdBreaches: result.thresholdBreaches.length,
    durationMs: result.durationMs,
    metrics: metricIds,
    since,
  });

  return result;
}
