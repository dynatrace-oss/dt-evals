import { detectDriftBatch, DRIFT_METRIC_ID } from '@dynatrace-oss/dt-eval-lib';
import type { DriftResult, DriftOptions } from '@dynatrace-oss/dt-eval-lib';
import type { DynatraceClient } from '../dt/client.js';
import { logger } from '../logger/index.js';

export { DRIFT_METRIC_ID };
export type { DriftResult };

interface ScoreRecord {
  'gen_ai.evaluation.name'?: string;
  'gen_ai.evaluation.score.value'?: number;
  [key: string]: unknown;
}

async function fetchScoresFromDT(
  dtClient: DynatraceClient,
  serviceName: string | undefined,
  window: string,
  excludeRunId?: string,
  excludeEvalType = 'drift',
): Promise<Record<string, number[]>> {
  const serviceFilter = serviceName ? `| filter dt.service.name == "${serviceName}"` : '';
  const runFilter = excludeRunId ? `| filter dt.eval.run_id != "${excludeRunId}"` : '';

  const query = `fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
| filter gen_ai.evaluation.type != "${excludeEvalType}"
${serviceFilter}
${runFilter}
| filter timestamp > now() - ${window}
| fields gen_ai.evaluation.name, gen_ai.evaluation.score.value`;

  try {
    const records = await dtClient.executeDql(query) as ScoreRecord[];
    const grouped: Record<string, number[]> = {};
    for (const r of records) {
      const metric = r['gen_ai.evaluation.name'];
      const value = r['gen_ai.evaluation.score.value'];
      if (typeof metric === 'string' && typeof value === 'number') {
        (grouped[metric] ??= []).push(value);
      }
    }
    return grouped;
  } catch (err) {
    logger.debug(`Drift DT query failed: ${(err as Error).message}`);
    return {};
  }
}

export async function runDriftDetection(
  dtClient: DynatraceClient,
  /** Scores collected from the current run. Empty when drift runs standalone. */
  currentScores: Record<string, number[]>,
  serviceName: string | undefined,
  runId: string,
  since: string,
  baselineWindow = '7d',
  options?: DriftOptions,
): Promise<DriftResult[]> {
  const hasCurrentRunScores = Object.values(currentScores).some(s => s.length > 0);

  let resolvedCurrent = currentScores;
  let resolvedBaseline: Record<string, number[]>;

  if (hasCurrentRunScores) {
    // Normal mode: current scores come from this run; baseline from previous runs in DT
    logger.step('Fetching drift baseline from Dynatrace...');
    const t0 = Date.now();
    resolvedBaseline = await fetchScoresFromDT(dtClient, serviceName, baselineWindow, runId);
    logger.timing('Drift baseline fetch', Date.now() - t0, { baselineWindow });
  } else {
    // Standalone mode: no LLM-as-judge metrics in this run — fetch both windows from DT
    logger.step(`Fetching drift windows from Dynatrace (current: ${since}, baseline: ${baselineWindow})...`);
    const t0 = Date.now();
    const [current, baseline] = await Promise.all([
      fetchScoresFromDT(dtClient, serviceName, since),
      fetchScoresFromDT(dtClient, serviceName, baselineWindow),
    ]);
    resolvedCurrent = current;
    // Baseline = full 7d window minus the recent `since` window overlap
    // Simple approach: use full 7d as baseline (includes recent, slight overlap is acceptable)
    resolvedBaseline = baseline;
    logger.timing('Drift windows fetch', Date.now() - t0, {
      currentMetrics: Object.keys(resolvedCurrent).length,
      baselineMetrics: Object.keys(resolvedBaseline).length,
    });
  }

  const metrics = [
    ...new Set([...Object.keys(resolvedCurrent), ...Object.keys(resolvedBaseline)]),
  ].filter(m => (resolvedCurrent[m]?.length ?? 0) > 0 || (resolvedBaseline[m]?.length ?? 0) > 0);

  if (metrics.length === 0) {
    logger.warn('Drift: no evaluation scores found in Dynatrace — run LLM-as-judge evals first to build a baseline');
    return [];
  }

  const scoreMap: Record<string, { baseline: number[]; current: number[] }> = {};
  for (const metric of metrics) {
    scoreMap[metric] = {
      baseline: resolvedBaseline[metric] ?? [],
      current: resolvedCurrent[metric] ?? [],
    };
  }

  const results = detectDriftBatch(scoreMap, options);

  const detected = results.filter(r => r.detected);
  if (detected.length === 0) {
    logger.info(`Drift: no significant drift detected across ${results.length} metrics`);
  } else {
    for (const r of detected) {
      const direction = r.meanShift < 0 ? '↓' : '↑';
      logger.warn(
        `Drift [${r.severity.toUpperCase()}] ${r.metric}: ` +
        `mean ${direction}${Math.abs(r.meanShift).toFixed(3)} ` +
        `(baseline ${r.baseline.mean.toFixed(3)} → current ${r.current.mean.toFixed(3)}, ` +
        `pass rate ${(r.passRateChange * 100).toFixed(1)}%, ` +
        `n_baseline=${r.baseline.sampleSize}, n_current=${r.current.sampleSize})`,
      );
    }
  }

  return results;
}

export function buildDriftBizevents(
  results: DriftResult[],
  runId: string,
  serviceName: string | undefined,
): object[] {
  return results.map(r => ({
    'event.type': 'gen_ai.evaluation.result',
    'gen_ai.evaluation.type': 'drift',
    'gen_ai.evaluation.method': 'statistical',
    'gen_ai.evaluation.version': 'v1.0',
    'gen_ai.evaluation.spec_id': 'evalspec_drift_v1',
    'gen_ai.evaluation.name': r.metric,
    'gen_ai.evaluation.score.value': r.effectSize,
    'gen_ai.evaluation.score.label': r.detected ? 'fail' : 'pass',
    'gen_ai.evaluation.score.explanation': r.detected
      ? `Drift detected (${r.severity}): mean shift ${r.meanShift >= 0 ? '+' : ''}${r.meanShift.toFixed(3)}, pass rate change ${(r.passRateChange * 100).toFixed(1)}%`
      : 'No significant drift detected',
    'gen_ai.evaluation.drift.severity': r.severity,
    'gen_ai.evaluation.drift.mean_shift': r.meanShift,
    'gen_ai.evaluation.drift.pass_rate_change': r.passRateChange,
    'gen_ai.evaluation.drift.effect_size': r.effectSize,
    'gen_ai.evaluation.drift.baseline.mean': r.baseline.mean,
    'gen_ai.evaluation.drift.baseline.pass_rate': r.baseline.passRate,
    'gen_ai.evaluation.drift.baseline.sample_size': r.baseline.sampleSize,
    'gen_ai.evaluation.drift.current.mean': r.current.mean,
    'gen_ai.evaluation.drift.current.pass_rate': r.current.passRate,
    'gen_ai.evaluation.drift.current.sample_size': r.current.sampleSize,
    'dt.eval.run_id': runId,
    'gen_ai.eval.client': 'dt-eval-cli',
    ...(serviceName ? { 'dt.service.name': serviceName } : {}),
  }));
}
