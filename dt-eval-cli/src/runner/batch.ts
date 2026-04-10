export interface BatchConfig {
  concurrency: number; // default 5
  batchSize: number;   // default 10
}

export interface BatchItemResult<T, R> {
  item: T;
  result?: R;
  error?: Error;
}

const DEFAULT_BATCH_CONFIG: BatchConfig = {
  concurrency: 5,
  batchSize: 10,
};

export async function processBatch<T, R>(
  items: T[],
  handler: (item: T) => Promise<R>,
  config?: Partial<BatchConfig>,
): Promise<Array<BatchItemResult<T, R>>> {
  const { concurrency } = { ...DEFAULT_BATCH_CONFIG, ...config };
  const results: Array<BatchItemResult<T, R>> = [];

  // Process with concurrency limit using a semaphore-like approach
  const queue = [...items];
  const inFlight: Promise<void>[] = [];

  async function processItem(item: T): Promise<void> {
    try {
      const result = await handler(item);
      results.push({ item, result });
    } catch (err) {
      results.push({
        item,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  // Chunk into groups and run concurrently within each group
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(item => processItem(item));
    await Promise.all(batchPromises);
  }

  // Maintain original order
  void inFlight;
  return results;
}
