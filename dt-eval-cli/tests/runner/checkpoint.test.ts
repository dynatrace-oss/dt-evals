import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { appendRunRecord, readRunRecords } from '../../src/runner/checkpoint.js';
import type { RunRecord } from '../../src/runner/checkpoint.js';

const TEST_DIR = join(tmpdir(), `dt-eval-checkpoint-test-${Date.now()}`);

function makeRecord(overrides?: Partial<RunRecord>): RunRecord {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    spansEvaluated: 10,
    resultsWritten: 10,
    errors: 0,
    thresholdBreaches: 0,
    durationMs: 1234,
    metrics: ['toxicity', 'relevance'],
    since: '1h',
    ...overrides,
  };
}

describe('checkpoint', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('appendRunRecord creates file if missing', async () => {
    const record = makeRecord({ runId: 'run-create-test' });
    await appendRunRecord(record, TEST_DIR);

    const records = await readRunRecords(TEST_DIR);
    expect(records).toHaveLength(1);
    expect(records[0]!.runId).toBe('run-create-test');
  });

  it('appendRunRecord appends to existing records', async () => {
    const r1 = makeRecord({ runId: 'run-first' });
    const r2 = makeRecord({ runId: 'run-second' });

    await appendRunRecord(r1, TEST_DIR);
    await appendRunRecord(r2, TEST_DIR);

    const records = await readRunRecords(TEST_DIR);
    expect(records).toHaveLength(2);
    expect(records[0]!.runId).toBe('run-first');
    expect(records[1]!.runId).toBe('run-second');
  });

  it('readRunRecords returns empty array when file missing', async () => {
    const records = await readRunRecords(join(TEST_DIR, 'nonexistent'));
    expect(records).toEqual([]);
  });

  it('readRunRecords returns existing records', async () => {
    const r = makeRecord({ runId: 'run-read-test', spansEvaluated: 42 });
    await appendRunRecord(r, TEST_DIR);

    const records = await readRunRecords(TEST_DIR);
    expect(records).toHaveLength(1);
    expect(records[0]!.spansEvaluated).toBe(42);
  });

  it('round-trips errorSamples when set on the record', async () => {
    const r = makeRecord({
      runId: 'run-with-errors',
      errors: 27,
      errorSamples: [
        '404 model: sonnet (×9)',
        "Cannot find package '@anthropic-ai/sdk' (×18)",
      ],
    });
    await appendRunRecord(r, TEST_DIR);

    const records = await readRunRecords(TEST_DIR);
    expect(records[0]!.errorSamples).toEqual([
      '404 model: sonnet (×9)',
      "Cannot find package '@anthropic-ai/sdk' (×18)",
    ]);
  });

  it('errorSamples is undefined for older records that omit it', async () => {
    const r = makeRecord({ runId: 'run-legacy' });
    await appendRunRecord(r, TEST_DIR);

    const records = await readRunRecords(TEST_DIR);
    expect(records[0]!.errorSamples).toBeUndefined();
  });

  it('limits to 100 most recent records when appending', async () => {
    // Append 105 records
    for (let i = 0; i < 105; i++) {
      await appendRunRecord(makeRecord({ runId: `run-${i}` }), TEST_DIR);
    }

    const records = await readRunRecords(TEST_DIR);
    expect(records).toHaveLength(100);
    // The first 5 should have been pruned, last record should be run-104
    expect(records[records.length - 1]!.runId).toBe('run-104');
    expect(records[0]!.runId).toBe('run-5');
  });
});
