import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RunRecord {
  runId: string;
  timestamp: string;
  spansEvaluated: number;
  resultsWritten: number;
  errors: number;
  thresholdBreaches: number;
  durationMs: number;
  metrics: string[];
  since: string;
  /**
   * Top distinct error messages from failed evals on this run. Persisted so
   * `dt-evals runs show <runId>` can surface them after the fact, not only
   * during the live `dt-evals run` output. Capped to a few entries with
   * `(×N)` suffix when duplicates collapse. Optional for back-compat with
   * records written by older CLI versions.
   */
  errorSamples?: string[];
}

const DEFAULT_STORAGE_DIR = join(homedir(), '.dt-eval');
const MAX_RECORDS = 100;

export async function appendRunRecord(record: RunRecord, storageDir?: string): Promise<void> {
  const dir = storageDir ?? DEFAULT_STORAGE_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, 'runs.json');

  let records: RunRecord[] = [];
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      records = JSON.parse(content) as RunRecord[];
      if (!Array.isArray(records)) {
        records = [];
      }
    } catch {
      records = [];
    }
  }

  records.push(record);

  // Keep only the most recent MAX_RECORDS
  if (records.length > MAX_RECORDS) {
    records = records.slice(records.length - MAX_RECORDS);
  }

  writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
}

export async function readRunRecords(storageDir?: string): Promise<RunRecord[]> {
  const dir = storageDir ?? DEFAULT_STORAGE_DIR;
  const filePath = join(dir, 'runs.json');

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const records = JSON.parse(content) as RunRecord[];
    if (!Array.isArray(records)) {
      return [];
    }
    return records;
  } catch {
    return [];
  }
}
