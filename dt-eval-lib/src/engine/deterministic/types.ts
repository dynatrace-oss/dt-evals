/** Result of a deterministic scorer, before mapping onto the binary scale. */
export interface DeterministicOutcome {
  passed: boolean;
  summary: string;
  reasoning: string;
}
