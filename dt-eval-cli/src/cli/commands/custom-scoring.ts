import {
  BINARY_SCALE,
  CONTINUOUS_SCALE,
  LIKERT_SCALE,
} from '@dynatrace-oss/dt-eval-lib';
import type { ScoringScale, ScoringScaleType } from '@dynatrace-oss/dt-eval-lib';

export function buildCustomScoring(
  type: ScoringScaleType,
  threshold: number,
): ScoringScale {
  const base =
    type === 'binary'
      ? BINARY_SCALE
      : type === 'likert'
        ? LIKERT_SCALE
        : CONTINUOUS_SCALE;

  return {
    ...base,
    threshold,
  };
}
