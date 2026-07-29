import { randomUUID } from 'node:crypto';
import { evaluate, getPrompt, type EvalConfig, type EvalInput, type EvalResult } from '@dynatrace-oss/dt-eval-lib';
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

/**
 * Phase-transition events emitted by `runEvals` so a CLI / UI can render
 * accurate live progress. Each event names the phase, and where it makes
 * sense includes timing and counts so the caller can show e.g.
 * "Fetched 9 spans in 234ms" instead of a static "Fetching..." spinner.
 */
export type RunProgressEvent =
  | { phase: 'fetching' }
  | { phase: 'fetched'; spans: number; durationMs: number }
  | { phase: 'preparing'; sampled: number; total: number }
  | { phase: 'evaluating-start'; tasks: number; spans: number; metrics: number }
  | { phase: 'eval-completed'; completed: number; total: number; metric: string; traceId: string; durationMs: number; error?: string }
  | { phase: 'evaluating-done'; tasks: number; errors: number; durationMs: number }
  | { phase: 'writing'; payloads: number }
  | { phase: 'written'; payloads: number; durationMs: number };

export interface RunOptions {
  since?: string;
  sample?: number;    // percent 0-100
  metrics?: MetricEntry[];
  dryRun?: boolean;
  ci?: boolean;
  concurrency?: number;
  /** Include the evaluated prompt/response in bizevents. Falls back to `storeEvaluatedPrompt` in the config when omitted. Default: false. */
  storeEvaluatedPrompt?: boolean;
  /**
   * Receives phase-transition events as the run progresses. Used by the CLI
   * to drive an accurate spinner. When omitted, the runner falls back to the
   * static `logger.step` / `logger.info` phase markers it has always emitted.
   */
  onProgress?: (event: RunProgressEvent) => void;
}

export interface RunResult {
  runId: string;
  spansEvaluated: number;
  resultsWritten: number;
  errors: number;
  errorSamples: string[];   // deduplicated sample of error messages for user display
  thresholdBreaches: Array<{ metric: string; traceId: string; score: number }>;
  durationMs: number;
  evaluatorResults: EvaluatorRunResult[];
}

export interface EvaluatorRunResult {
  metric: string;
  successes: number;
  total: number;
  errors: number;
  avgDurationMs: number;
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
    case 'context': return span.context;
    case 'systemInstruction': return span.systemInstruction;
    case 'model': return span.requestModel;
    case 'userPrompt': return span.userPrompt;
  }
}

/** Build the EvalInput passed to dt-eval-lib, applying any per-metric routing. */
function buildEvalInput(span: GenAiSpan, inputs: MetricInputs | undefined): EvalInput {
  if (!inputs) {
    return { input: span.input, output: span.output, context: span.context };
  }
  return {
    input: (inputs.input && resolveCanonicalField(span, inputs.input)) ?? span.input,
    output: (inputs.output && resolveCanonicalField(span, inputs.output)) ?? span.output,
    context: (inputs.context && resolveCanonicalField(span, inputs.context)) ?? span.context,
  };
}

interface EvalTaskResult {
  span: GenAiSpan;
  metricId: string;
  metricName: string;
  evalResult: EvalResult;
  /** The exact input the judge was given — may be a routed subset of span fields. */
  evalInput: EvalInput;
}

interface EvaluatorRunStats {
  metric: string;
  successes: number;
  total: number;
  errors: number;
  durationMs: number;
}

function recordEvaluatorOutcome(stats: EvaluatorRunStats | undefined, succeeded: boolean, durationMs: number): void {
  if (!stats) return;

  stats.total++;
  stats.durationMs += durationMs;
  if (succeeded) {
    stats.successes++;
  } else {
    stats.errors++;
  }
}

export type { EvalResult };

export interface DtClients {
  /** Tenant for fetching GenAI spans (DQL read). */
  origin: DynatraceClient;
  /** Tenant for writing eval bizevents/metrics. */
  destination: DynatraceClient;
}

export async function runEvals(
  clients: DtClients | DynatraceClient,
  evalConfig: DtEvalConfig,
  opts: RunOptions,
): Promise<RunResult> {
  const { origin: readClient, destination: writeClient } =
    'origin' in clients ? clients : { origin: clients, destination: clients };
  const startTime = Date.now();
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomUUID().slice(0, 8)}`;

  const since = opts.since ?? evalConfig.scope.since;
  const metricEntries: MetricEntry[] = opts.metrics ?? evalConfig.metrics.enabled;
  const concurrency = opts.concurrency ?? 5;
  const emit = opts.onProgress;

  // 1. Fetch spans via DQL
  if (!emit) logger.step('Fetching spans...');
  emit?.({ phase: 'fetching' });
  const query = buildGenAiSpanQuery({
    app: evalConfig.scope.service,
    since,
    errorsOnly: evalConfig.scope.sampling?.strategy === 'errors-only',
    spanFields: evalConfig.scope.spanFields,
  });
  logger.debug(`DQL query:\n${query}`);

  const t0Dql = Date.now();
  const rawRecords = await readClient.executeDql(query) as unknown[];
  const dqlMs = Date.now() - t0Dql;
  logger.timing('DQL fetch', dqlMs, { rawRecords: (rawRecords as unknown[]).length });

  const t0Parse = Date.now();
  const allSpans = parseSpanResults(rawRecords, { spanFields: evalConfig.scope.spanFields });
  logger.timing('Parse spans', Date.now() - t0Parse, { spans: allSpans.length });
  emit?.({ phase: 'fetched', spans: allSpans.length, durationMs: dqlMs });

  // 2. Apply sampling
  if (!emit) logger.step('Applying sampling...');
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
  if (!emit) logger.step('Masking PII...');
  const t0Mask = Date.now();
  const maskedSpans = sampledSpans.map(span => maskSpan(span));
  logger.timing('PII masking', Date.now() - t0Mask, { spans: maskedSpans.length });
  emit?.({ phase: 'preparing', sampled: maskedSpans.length, total: allSpans.length });

  // 4. Build task list (span × metric), excluding drift which runs separately
  const metricIds = metricEntries.map(metricId);
  const evalEntries = metricEntries.filter(e => metricId(e) !== DRIFT_METRIC_ID);
  const runDrift = metricIds.includes(DRIFT_METRIC_ID);

  const tasks: EvalTask[] = maskedSpans.flatMap(span =>
    evalEntries.map(entry => ({ span, metric: metricId(entry), inputs: metricInputs(entry) })),
  );
  const evaluatorStats = new Map<string, EvaluatorRunStats>();
  for (const entry of evalEntries) {
    const id = metricId(entry);
    evaluatorStats.set(id, { metric: id, successes: 0, total: 0, errors: 0, durationMs: 0 });
  }

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
      evaluatorResults: [...evaluatorStats.values()].map(s => ({
        metric: s.metric,
        successes: s.successes,
        total: s.total,
        errors: s.errors,
        avgDurationMs: 0,
      })),
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
      project: evalConfig.judge.project,
      location: evalConfig.judge.location,
      model: evalConfig.judge.model,
      timeout: evalConfig.judge.timeout,
      maxRetries: evalConfig.judge.maxRetries,
    },
  };

  // 6. Evaluate via dt-eval-lib in parallel batches
  if (!emit) logger.info(`Evaluating ${maskedSpans.length} spans × ${metricIds.length} metrics...`);
  logger.debug(`judge provider=${judgeProvider} model=${judgeModel || '<default>'} concurrency=${concurrency}`);
  emit?.({
    phase: 'evaluating-start',
    tasks: tasks.length,
    spans: maskedSpans.length,
    metrics: evalEntries.length,
  });
  const t0Eval = Date.now();
  let evalCount = 0;
  let evalErrors = 0;
  const batchResults = await processBatch<EvalTask, EvalTaskResult>(
    tasks,
    async task => {
      const t0 = Date.now();
      const input: EvalInput = buildEvalInput(task.span, task.inputs);
      try {
        const prompt = getPrompt(task.metric);
        const evalResult = await evaluate(prompt, input, libConfig);
        evalCount++;
        const elapsed = Date.now() - t0;
        logger.debug(`eval [${evalCount}/${tasks.length}] ${task.metric} ${judgeProvider}/${judgeModel} trace=${task.span.traceId.slice(0, 8)}… ${elapsed}ms score=${evalResult.score.value}`);
        recordEvaluatorOutcome(evaluatorStats.get(task.metric), true, elapsed);
        emit?.({
          phase: 'eval-completed',
          completed: evalCount,
          total: tasks.length,
          metric: task.metric,
          traceId: task.span.traceId,
          durationMs: elapsed,
        });
        return { span: task.span, metricId: task.metric, metricName: prompt.name, evalResult, evalInput: input };
      } catch (err) {
        evalCount++;
        evalErrors++;
        const elapsed = Date.now() - t0;
        recordEvaluatorOutcome(evaluatorStats.get(task.metric), false, elapsed);
        emit?.({
          phase: 'eval-completed',
          completed: evalCount,
          total: tasks.length,
          metric: task.metric,
          traceId: task.span.traceId,
          durationMs: elapsed,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    { concurrency },
  );
  const evalMs = Date.now() - t0Eval;
  logger.timing('Eval batch', evalMs, { tasks: tasks.length, concurrency });
  emit?.({ phase: 'evaluating-done', tasks: tasks.length, errors: evalErrors, durationMs: evalMs });

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
  const evaluatorResults: EvaluatorRunResult[] = [...evaluatorStats.values()].map(s => ({
    metric: s.metric,
    successes: s.successes,
    total: s.total,
    errors: s.errors,
    avgDurationMs: s.total > 0 ? Math.round(s.durationMs / s.total) : 0,
  }));

  // 8. Write bizevents
  if (!emit) logger.step('Writing bizevents...');
  const storeEvaluatedPrompt = opts.storeEvaluatedPrompt ?? evalConfig.storeEvaluatedPrompt ?? false;
  const writer = new BizeventWriter(writeClient);
  const payloads: BizeventPayload[] = successResults.map(r =>
    buildBizeventPayload(r.span, r.metricId, r.metricName, r.evalResult, runId, judgeProvider, judgeModel, evalConfig.scope.service, r.evalInput, storeEvaluatedPrompt),
  );
  emit?.({ phase: 'writing', payloads: payloads.length });

  const t0Ingest = Date.now();
  await writer.writeBatch(payloads);
  const writeMs = Date.now() - t0Ingest;
  logger.timing('Bizevent ingest', writeMs, { payloads: payloads.length });
  emit?.({ phase: 'written', payloads: payloads.length, durationMs: writeMs });

  // 9. Run drift detection (if selected as a metric)
  if (runDrift && !opts.dryRun) {
    // Build per-metric score arrays from this run
    const currentScores: Record<string, number[]> = {};
    for (const r of successResults) {
      (currentScores[r.metricId] ??= []).push(r.evalResult.score.value);
    }
    // Drift compares current run against historical eval bizevents on the
    // destination tenant (where eval results live).
    const driftResults = await runDriftDetection(
      writeClient,
      currentScores,
      evalConfig.scope.service,
      runId,
      since,
    );
    if (driftResults.length > 0) {
      const driftEvents = buildDriftBizevents(driftResults, runId, evalConfig.scope.service);
      await writeClient.ingestBizevents(driftEvents);
      logger.timing('Drift ingest', 0, { events: driftEvents.length });
    }
  }

  // 10. Check thresholds
  const thresholdBreaches: RunResult['thresholdBreaches'] = [];
  if (evalConfig.alerts?.thresholds) {
    for (const r of successResults) {
      const threshold = evalConfig.alerts.thresholds[r.metricId];
      if (threshold !== undefined && r.evalResult.score.value < threshold) {
        thresholdBreaches.push({
          metric: r.metricId,
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
    evaluatorResults,
  };

  if (!emit) logger.success(`Run complete: ${payloads.length} results written`);

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
    errorSamples: result.errorSamples.length > 0 ? result.errorSamples : undefined,
  });

  return result;
}
