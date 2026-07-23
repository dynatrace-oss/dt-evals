import { describe, expect, it } from 'vitest';
import { buildCustomScoring } from '../../src/cli/commands/custom-scoring.js';

describe('buildCustomScoring', () => {
  it('builds a continuous scale with the default range', () => {
    expect(buildCustomScoring('continuous', 0.7)).toEqual({
      type: 'continuous',
      range: [0, 1],
      threshold: 0.7,
    });
  });

  it('builds a binary scale with the default range', () => {
    expect(buildCustomScoring('binary', 1)).toEqual({
      type: 'binary',
      range: [0, 1],
      threshold: 1,
    });
  });

  it('builds a likert scale with labels intact', () => {
    expect(buildCustomScoring('likert', 4)).toEqual({
      type: 'likert',
      range: [1, 5],
      threshold: 4,
      labels: {
        1: 'Very Poor',
        2: 'Poor',
        3: 'Average',
        4: 'Good',
        5: 'Excellent',
      },
    });
  });
});
