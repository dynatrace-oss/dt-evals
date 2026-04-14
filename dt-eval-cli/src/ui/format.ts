import pc from 'picocolors';
import type { RunResult } from '../runner/index.js';
import type { DtEvalConfig } from '../config/schema.js';

export function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

export function formatScore(value: number, label: 'pass' | 'fail'): string {
  const scoreStr = value.toFixed(2);
  if (label === 'pass') {
    return pc.green(`${scoreStr} ✓`);
  }
  return pc.red(`${scoreStr} ✗`);
}

export function formatRunSummary(result: RunResult): string {
  const lines: string[] = [];
  lines.push(`Run ${result.runId} complete in ${formatDuration(result.durationMs)}`);
  lines.push(`  Spans evaluated: ${result.spansEvaluated}`);
  lines.push(`  Results written: ${result.resultsWritten}`);
  lines.push(`  Errors: ${result.errors}`);
  if (result.thresholdBreaches.length > 0) {
    lines.push(`  Threshold breaches: ${result.thresholdBreaches.length}`);
    for (const breach of result.thresholdBreaches) {
      lines.push(`    - ${breach.metric} [${breach.traceId}]: score=${breach.score}`);
    }
  }
  return lines.join('\n');
}

export function redactSecrets(config: DtEvalConfig): DtEvalConfig {
  return {
    ...config,
    dynatrace: {
      ...config.dynatrace,
      apiToken: config.dynatrace.apiToken ? '***' : undefined,
    },
    judge: {
      ...config.judge,
      apiKey: config.judge.apiKey ? '***' : undefined,
    },
  };
}
