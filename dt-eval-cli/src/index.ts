#!/usr/bin/env -S node --no-warnings

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Auto-load .env from cwd if present (no external dependency needed in Node 20+)
const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) {
  const { readFileSync } = await import('node:fs');
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

import { runCli } from './cli/index.js';

runCli().catch(err => {
  console.error((err as Error).message);
  process.exit(1);
});
