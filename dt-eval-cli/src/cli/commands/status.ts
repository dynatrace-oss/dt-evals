import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../config/index.js';
import { metricId } from '../../config/schema.js';
import { printBanner } from '../../ui/banner.js';

interface RunLogEntry {
  runId: string;
  timestamp: string;
  spansEvaluated: number;
  resultsWritten: number;
  errors: number;
  durationMs: number;
}

function getLastRunSummary(): RunLogEntry | null {
  const runsPath = join(homedir(), '.dt-eval', 'runs.json');
  if (!existsSync(runsPath)) {
    return null;
  }
  try {
    const content = readFileSync(runsPath, 'utf-8');
    const runs = JSON.parse(content) as RunLogEntry[];
    if (Array.isArray(runs) && runs.length > 0) {
      return runs[runs.length - 1] ?? null;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

async function checkDtConnection(environmentUrl: string, apiToken?: string): Promise<boolean | null> {
  if (!environmentUrl || !apiToken) {
    return false;
  }
  try {
    const url = `${environmentUrl.replace(/\/$/, '')}/platform/storage/query/v1/query:execute`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Api-Token ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'fetch logs | limit 1', requestTimeoutMilliseconds: 5000 }),
      signal: AbortSignal.timeout(8000),
    });
    // 200 or 400 (bad query) = connectivity OK; 401 = bad token; 403 = token lacks DQL scope
    if (response.status === 401) return false;
    if (response.status === 403) return null; // connected but token needs storage:logs:read scope
    return true;
  } catch {
    return false;
  }
}

export function createStatusCommand(): Command {
  const cmd = new Command('status');
  cmd.description('Show current configuration, connectivity, and last evaluation run');

  cmd.action(async () => {
    printBanner();
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      console.log('Status: config not found or invalid');
      console.log(`  Error: ${(err as Error).message}`);
      console.log('  Run "dt-eval-cli configure" to set up your configuration.');
      return;
    }

    const projectConfigPath = join(process.cwd(), '.dt-eval.yaml');
    const globalConfigPath = join(homedir(), '.dt-eval', 'config.yaml');

    console.log('=== dt-eval-cli status ===\n');

    console.log('Config:');
    console.log(`  Project file:   ${existsSync(projectConfigPath) ? projectConfigPath : '(not found)'}`);
    console.log(`  Global file:    ${existsSync(globalConfigPath) ? globalConfigPath : '(not found)'}`);
    console.log(`  Schema version: ${config.schemaVersion}`);

    console.log('\nDynatrace:');
    console.log(`  Environment: ${config.dynatrace.environmentUrl || '(not set)'}`);
    console.log(`  API token:   ${config.dynatrace.apiToken ? '***' : '(not set)'}`);

    process.stdout.write('  Connection:  checking...');
    const connected = await checkDtConnection(config.dynatrace.environmentUrl, config.dynatrace.apiToken);
    const connLabel = connected === true ? 'OK' : connected === null ? 'OK (token needs storage:logs:read scope for DQL)' : 'FAILED';
    process.stdout.write(`\r  Connection:  ${connLabel}     \n`);

    console.log('\nEvaluator:');
    console.log(`  Provider: ${config.judge.provider}`);
    console.log(`  Model:    ${config.judge.model ?? '(auto)'}`);
    console.log(`  API key:  ${config.judge.apiKey ? '***' : '(not set)'}`);

    console.log('\nScope:');
    console.log(`  Time window: ${config.scope.since}`);
    const sampling = config.scope.sampling;
    console.log(`  Sampling:    ${sampling?.strategy ?? 'random'} (${
      !sampling || sampling.strategy === 'random'
        ? `${sampling?.percent ?? 5}%`
        : sampling.strategy === 'latest'
        ? `top ${sampling.count ?? 'all'}`
        : 'errors only'
    })`);

    console.log('\nEvaluators:');
    console.log(`  Enabled: ${config.metrics.enabled.map(metricId).join(', ')}`);

    const lastRun = getLastRunSummary();
    console.log('\nLast evaluation run:');
    if (lastRun) {
      console.log(`  Run ID:          ${lastRun.runId}`);
      console.log(`  Time:            ${lastRun.timestamp}`);
      console.log(`  Spans evaluated: ${lastRun.spansEvaluated}`);
      console.log(`  Results written: ${lastRun.resultsWritten}`);
      console.log(`  Errors:          ${lastRun.errors}`);
      console.log(`  Duration:        ${lastRun.durationMs}ms`);
    } else {
      console.log('  No evaluation runs recorded yet.');
    }
  });

  return cmd;
}
