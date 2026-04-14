import type { GenAiSpan } from '../dt/types.js';
import type { ScopeConfig } from '../config/schema.js';

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function applySampling(spans: GenAiSpan[], config: ScopeConfig): GenAiSpan[] {
  const { strategy, percent, count } = config.sampling;

  if (strategy === 'random') {
    const pct = percent ?? 100;
    if (pct >= 100) {
      return spans;
    }
    const shuffled = shuffleArray(spans);
    const take = Math.floor((pct / 100) * shuffled.length);
    return shuffled.slice(0, take);
  }

  if (strategy === 'latest') {
    const take = count ?? spans.length;
    const sorted = [...spans].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return sorted.slice(0, take);
  }

  if (strategy === 'errors-only') {
    return spans.filter(s => s.isError === true);
  }

  return spans;
}
