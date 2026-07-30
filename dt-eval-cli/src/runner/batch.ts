export interface BatchConfig {
  concurrency: number; // default 5
}

export interface BatchItemResult<T, R> {
  item: T;
  result?: R;
  error?: Error;
}

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  concurrency: 5,
};

export async function processBatch<T, R>(
  items: T[],
  handler: (item: T) => Promise<R>,
  config?: Partial<BatchConfig>,
): Promise<Array<BatchItemResult<T, R>>> {
  const concurrency = config?.concurrency ?? DEFAULT_BATCH_CONFIG.concurrency;
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error(`concurrency must be a positive integer, got ${concurrency}`);
  }

  const results = new Array<BatchItemResult<T, R>>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index]!;
      try {
        results[index] = { item, result: await handler(item) };
      } catch (err) {
        results[index] = {
          item,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
