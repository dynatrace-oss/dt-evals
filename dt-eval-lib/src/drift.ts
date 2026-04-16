/**
 * Population-level drift detection for LLM evaluation scores.
 *
 * Compares a current scoring window against a baseline using Cohen's d
 * as the effect size and pass-rate delta as a complementary signal.
 */

export interface DriftOptions {
  /** Cohen's d threshold above which drift is considered detected. Default: 0.2 */
  effectSizeThreshold?: number;
  /** Score value at or above which a sample is counted as a "pass". Default: 0.7 */
  passThreshold?: number;
}

export interface DriftWindowStats {
  mean: number;
  stddev: number;
  passRate: number;
  sampleSize: number;
}

export interface DriftResult {
  metric: string;
  detected: boolean;
  /** "low" | "medium" | "high" based on Cohen's d magnitude */
  severity: "low" | "medium" | "high";
  /** current.mean - baseline.mean */
  meanShift: number;
  /** current.passRate - baseline.passRate */
  passRateChange: number;
  /** Cohen's d effect size (absolute value) */
  effectSize: number;
  baseline: DriftWindowStats;
  current: DriftWindowStats;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function windowStats(scores: number[], passThreshold: number): DriftWindowStats {
  const n = scores.length;
  if (n === 0) {
    return { mean: 0, stddev: 0, passRate: 0, sampleSize: 0 };
  }
  const mean = scores.reduce((s, v) => s + v, 0) / n;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const passRate = scores.filter((v) => v >= passThreshold).length / n;
  return { mean, stddev, passRate, sampleSize: n };
}

function cohensD(a: DriftWindowStats, b: DriftWindowStats): number {
  const pooledStddev = Math.sqrt((a.stddev ** 2 + b.stddev ** 2) / 2);
  if (pooledStddev === 0) return 0;
  return Math.abs(b.mean - a.mean) / pooledStddev;
}

function severity(d: number): "low" | "medium" | "high" {
  if (d >= 0.8) return "high";
  if (d >= 0.5) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect drift for a single metric.
 */
export function detectDrift(
  metric: string,
  baselineScores: number[],
  currentScores: number[],
  options: DriftOptions = {},
): DriftResult {
  const { effectSizeThreshold = 0.2, passThreshold = 0.7 } = options;

  const baseline = windowStats(baselineScores, passThreshold);
  const current = windowStats(currentScores, passThreshold);
  const effectSize = cohensD(baseline, current);
  const detected =
    effectSize >= effectSizeThreshold && current.sampleSize > 0 && baseline.sampleSize > 0;

  return {
    metric,
    detected,
    severity: severity(effectSize),
    meanShift: current.mean - baseline.mean,
    passRateChange: current.passRate - baseline.passRate,
    effectSize,
    baseline,
    current,
  };
}

/**
 * Detect drift across multiple metrics in one call.
 */
export function detectDriftBatch(
  scoreMap: Record<string, { baseline: number[]; current: number[] }>,
  options: DriftOptions = {},
): DriftResult[] {
  return Object.entries(scoreMap).map(([metric, { baseline, current }]) =>
    detectDrift(metric, baseline, current, options),
  );
}
