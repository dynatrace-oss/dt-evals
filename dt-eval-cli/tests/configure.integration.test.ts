import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_JUDGE_MODELS } from '../src/config/defaults.js';

// Regression for AI-315: `configure --provider X` must persist X's default model,
// never the OpenAI default that resolveEffectiveConfig injects for a fresh config.
// Exercises the flag-only path end-to-end (no TTY, no network — flag mode does not probe).

const ROOT = process.cwd(); // package root when vitest runs
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const INDEX = join(ROOT, 'src/index.ts');

function runConfigure(provider: string): { provider?: string; model?: string } {
  const home = mkdtempSync(join(tmpdir(), 'dtcfg-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'dtcfg-cwd-'));
  execFileSync(
    TSX,
    ['--no-warnings', INDEX, 'configure',
      '--provider', provider, '--api-key', 'x',
      '--env-url', 'https://localhost:9', '--since', '1h'],
    { cwd, env: { ...process.env, HOME: home, NO_COLOR: '1' }, stdio: 'ignore' },
  );
  const file = join(cwd, '.dt-eval.yaml');
  if (!existsSync(file)) throw new Error(`config not written to ${file}`);
  const cfg = parseYaml(readFileSync(file, 'utf-8'));
  return { provider: cfg?.judge?.provider, model: cfg?.judge?.model };
}

describe('configure --provider (flag mode) default model', () => {
  beforeAll(() => {
    if (!existsSync(TSX)) throw new Error('tsx not found — run npm install');
  });

  it('persists the anthropic default, not the OpenAI default', () => {
    const cfg = runConfigure('anthropic');
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe(DEFAULT_JUDGE_MODELS['anthropic']);
    expect(cfg.model).not.toBe(DEFAULT_JUDGE_MODELS['openai']); // the AI-315 bug
  }, 30_000);

  it('persists the bedrock default, not the OpenAI default', () => {
    const cfg = runConfigure('bedrock');
    expect(cfg.provider).toBe('bedrock');
    expect(cfg.model).toBe(DEFAULT_JUDGE_MODELS['bedrock']);
    expect(cfg.model).not.toBe(DEFAULT_JUDGE_MODELS['openai']); // the AI-315 bug
  }, 30_000);

  it('leaves model unset for azure-openai (deployment name is user-defined)', () => {
    const cfg = runConfigure('azure-openai');
    expect(cfg.provider).toBe('azure-openai');
    expect(cfg.model).toBeUndefined();
  }, 30_000);
});
