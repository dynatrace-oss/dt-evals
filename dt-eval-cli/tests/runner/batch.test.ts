import { describe, it, expect, vi } from 'vitest';
import { processBatch } from '../../src/runner/batch.js';

describe('processBatch', () => {
  it('processes all items and returns results for each', async () => {
    const items = [1, 2, 3, 4, 5];
    const handler = async (n: number) => n * 2;

    const results = await processBatch(items, handler);

    expect(results).toHaveLength(5);
    expect(results.every(r => r.error === undefined)).toBe(true);
    expect(results.map(r => r.result)).toEqual([2, 4, 6, 8, 10]);
  });

  it('returns empty results for empty input', async () => {
    const results = await processBatch<number, number>([], async n => n);
    expect(results).toHaveLength(0);
  });

  it('collects errors without throwing', async () => {
    const items = [1, 2, 3];
    const handler = async (n: number) => {
      if (n === 2) throw new Error('item 2 failed');
      return n;
    };

    const results = await processBatch(items, handler);

    expect(results).toHaveLength(3);
    const errorResult = results.find(r => r.item === 2)!;
    expect(errorResult.error).toBeInstanceOf(Error);
    expect(errorResult.error?.message).toBe('item 2 failed');
    expect(errorResult.result).toBeUndefined();
  });

  it('partial failure does not stop other items from processing', async () => {
    const items = [1, 2, 3, 4, 5];
    const handler = async (n: number) => {
      if (n === 3) throw new Error('fail');
      return n * 10;
    };

    const results = await processBatch(items, handler);

    // 4 successes and 1 error
    const successes = results.filter(r => r.result !== undefined);
    const errors = results.filter(r => r.error !== undefined);

    expect(successes).toHaveLength(4);
    expect(errors).toHaveLength(1);
  });

  it('returns a result entry for each item', async () => {
    const items = ['a', 'b', 'c'];
    const results = await processBatch(items, async s => s.toUpperCase());

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.item).toBeDefined();
    }
  });

  it('respects concurrency limit by not exceeding it', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const items = Array.from({ length: 20 }, (_, i) => i);
    const handler = async (n: number) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 10));
      concurrent--;
      return n;
    };

    await processBatch(items, handler, { concurrency: 3 });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('starts new work as soon as a worker becomes available', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const started: number[] = [];

    const run = processBatch(
      [1, 2, 3],
      async n => {
        started.push(n);
        if (n === 1) await firstBlocked;
        return n;
      },
      { concurrency: 2 },
    );

    await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
    releaseFirst();

    const results = await run;
    expect(results.map(r => r.result)).toEqual([1, 2, 3]);
  });

  it('handles non-Error thrown values by wrapping them in Error', async () => {
    const items = [1];
    const handler = async (_n: number) => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'string error';
    };

    const results = await processBatch(items, handler);
    expect(results[0]!.error).toBeInstanceOf(Error);
    expect(results[0]!.error?.message).toBe('string error');
  });

  it('uses default concurrency of 5 when not specified', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const items = Array.from({ length: 30 }, (_, i) => i);
    const handler = async (n: number) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 5));
      concurrent--;
      return n;
    };

    await processBatch(items, handler);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it.each([0, -1, 2.5, NaN])(
    "rejects invalid concurrency: %s",
    async invalid => {
      await expect(processBatch([1], async n => n, { concurrency: invalid }))
        .rejects.toThrow("concurrency must be a positive integer");
    },
  );
});
