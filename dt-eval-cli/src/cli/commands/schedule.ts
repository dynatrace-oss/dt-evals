import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, validateConfig } from '../../config/index.js';
import { resolveEndpoints } from '../../config/schema.js';
import { DynatraceClient } from '../../dt/client.js';
import { runEvals } from '../../runner/index.js';
import { renderTable } from '../../ui/table.js';
import { logger } from '../../logger/index.js';

interface Schedule {
  id: string;
  name?: string;
  cron: string;
  since: string;
  sample: number;
  metrics?: string[];
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
}

const DEFAULT_STORAGE_DIR = join(homedir(), '.dt-eval');

function getSchedulesPath(storageDir: string): string {
  return join(storageDir, 'schedules.json');
}

async function readSchedules(storageDir?: string): Promise<Schedule[]> {
  const dir = storageDir ?? DEFAULT_STORAGE_DIR;
  const filePath = getSchedulesPath(dir);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const schedules = JSON.parse(content) as Schedule[];
    if (!Array.isArray(schedules)) return [];
    return schedules;
  } catch {
    return [];
  }
}

async function writeSchedules(schedules: Schedule[], storageDir?: string): Promise<void> {
  const dir = storageDir ?? DEFAULT_STORAGE_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = getSchedulesPath(dir);
  writeFileSync(filePath, JSON.stringify(schedules, null, 2), 'utf-8');
}

function validateCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5;
}

export function createScheduleCommand(): Command {
  const cmd = new Command('schedule');
  cmd.description('Manage scheduled evaluation runs');

  // schedule add
  const setCmd = new Command('add');
  setCmd.description('Add a new evaluation schedule');
  setCmd.requiredOption('--cron <expression>', 'Cron expression (e.g. "*/15 * * * *")');
  setCmd.requiredOption('--since <duration>', 'Time window (e.g. 1h)');
  setCmd.option('--sample <percent>', 'Percentage to sample', parseFloat, 100);
  setCmd.option('--name <name>', 'Schedule name');
  setCmd.option('--metrics <metrics>', 'Comma-separated metrics override');

  setCmd.action(async (options: {
    cron: string;
    since: string;
    sample: number;
    name?: string;
    metrics?: string;
  }) => {
    if (!validateCron(options.cron)) {
      logger.error('Invalid cron expression. Must have exactly 5 parts (e.g. "*/15 * * * *")');
      process.exit(1);
    }

    const schedule: Schedule = {
      id: randomUUID(),
      name: options.name,
      cron: options.cron,
      since: options.since,
      sample: options.sample,
      metrics: options.metrics ? options.metrics.split(',').map(m => m.trim()) : undefined,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    const schedules = await readSchedules();
    schedules.push(schedule);
    await writeSchedules(schedules);

    logger.success(`Schedule created: ${schedule.id}`);
  });

  // schedule list
  const listCmd = new Command('list');
  listCmd.description('List all schedules');

  listCmd.action(async () => {
    const schedules = await readSchedules();

    if (schedules.length === 0) {
      logger.info('No schedules configured.');
      return;
    }

    const headers = ['ID', 'Name', 'Cron', 'Since', 'Sample', 'Enabled', 'Last Run'];
    const rows = schedules.map(s => [
      s.id.slice(0, 8),
      s.name ?? '-',
      s.cron,
      s.since,
      `${s.sample}%`,
      s.enabled ? 'yes' : 'no',
      s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'never',
    ]);

    console.log(renderTable(headers, rows));
  });

  // schedule enable
  const enableCmd = new Command('enable');
  enableCmd.description('Enable a schedule');
  enableCmd.argument('<id>', 'Schedule ID');

  enableCmd.action(async (id: string) => {
    const schedules = await readSchedules();
    const schedule = schedules.find(s => s.id.startsWith(id));
    if (!schedule) {
      logger.error(`Schedule not found: ${id}`);
      process.exit(1);
    }
    schedule.enabled = true;
    await writeSchedules(schedules);
    logger.success(`Schedule ${schedule.id} enabled`);
  });

  // schedule disable
  const disableCmd = new Command('disable');
  disableCmd.description('Disable a schedule');
  disableCmd.argument('<id>', 'Schedule ID');

  disableCmd.action(async (id: string) => {
    const schedules = await readSchedules();
    const schedule = schedules.find(s => s.id.startsWith(id));
    if (!schedule) {
      logger.error(`Schedule not found: ${id}`);
      process.exit(1);
    }
    schedule.enabled = false;
    await writeSchedules(schedules);
    logger.success(`Schedule ${schedule.id} disabled`);
  });

  // schedule delete
  const deleteCmd = new Command('delete');
  deleteCmd.description('Delete a schedule');
  deleteCmd.argument('<id>', 'Schedule ID');

  deleteCmd.action(async (id: string) => {
    const schedules = await readSchedules();
    const index = schedules.findIndex(s => s.id.startsWith(id));
    if (index === -1) {
      logger.error(`Schedule not found: ${id}`);
      process.exit(1);
    }
    const [removed] = schedules.splice(index, 1);
    await writeSchedules(schedules);
    logger.success(`Schedule ${removed?.id} deleted`);
  });

  // schedule run
  const runCmd = new Command('run');
  runCmd.description('Manually trigger a schedule now');
  runCmd.argument('<id>', 'Schedule ID');

  runCmd.action(async (id: string) => {
    const schedules = await readSchedules();
    const schedule = schedules.find(s => s.id.startsWith(id));
    if (!schedule) {
      logger.error(`Schedule not found: ${id}`);
      process.exit(1);
    }

    let config;
    try {
      config = loadConfig();
      validateConfig(config);
    } catch (err) {
      logger.error(`Config error: ${(err as Error).message}`);
      process.exit(1);
    }

    const { origin, destination } = resolveEndpoints(config.dynatrace);
    if (!origin.apiToken || !destination.apiToken) {
      logger.error('dynatrace api token(s) required for origin and destination');
      process.exit(1);
    }

    const dtClients = {
      origin: new DynatraceClient({ environmentUrl: origin.environmentUrl, apiToken: origin.apiToken }),
      destination: new DynatraceClient({ environmentUrl: destination.environmentUrl, apiToken: destination.apiToken }),
    };

    try {
      const result = await runEvals(dtClients, config, {
        since: schedule.since,
        sample: schedule.sample,
        metrics: schedule.metrics,
      });

      // Update lastRunAt
      schedule.lastRunAt = new Date().toISOString();
      await writeSchedules(schedules);

      logger.success(`Schedule run complete: ${result.resultsWritten} results written`);
    } catch (err) {
      logger.error(`Schedule run failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

  cmd.addCommand(setCmd);
  cmd.addCommand(listCmd);
  cmd.addCommand(enableCmd);
  cmd.addCommand(disableCmd);
  cmd.addCommand(deleteCmd);
  cmd.addCommand(runCmd);

  return cmd;
}
