import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { readRunRecords } from '../../runner/checkpoint.js';
import type { RunRecord } from '../../runner/checkpoint.js';
import { renderTable } from '../../ui/table.js';
import { formatDuration } from '../../ui/format.js';
import { logger } from '../../logger/index.js';

function formatCsv(records: RunRecord[]): string {
  const headers = ['runId', 'timestamp', 'spansEvaluated', 'resultsWritten', 'errors', 'thresholdBreaches', 'durationMs', 'metrics', 'since'];
  const rows = records.map(r => [
    r.runId,
    r.timestamp,
    String(r.spansEvaluated),
    String(r.resultsWritten),
    String(r.errors),
    String(r.thresholdBreaches),
    String(r.durationMs),
    r.metrics.join(';'),
    r.since,
  ].map(v => `"${v}"`).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export function createRunsCommand(): Command {
  const cmd = new Command('runs');
  cmd.description('View and export past evaluation runs');

  // runs list
  const listCmd = new Command('list');
  listCmd.description('List recent evaluation runs');
  listCmd.option('--limit <n>', 'Number of runs to show', parseInt, 10);

  listCmd.action(async (options: { limit: number }) => {
    const records = await readRunRecords();
    if (records.length === 0) {
      logger.info('No evaluation runs found.');
      return;
    }

    const recent = records.slice(-options.limit);
    const headers = ['Run ID', 'Timestamp', 'Spans', 'Results', 'Errors', 'Breaches', 'Duration'];
    const rows = recent.map(r => [
      r.runId,
      new Date(r.timestamp).toLocaleString(),
      String(r.spansEvaluated),
      String(r.resultsWritten),
      String(r.errors),
      String(r.thresholdBreaches),
      formatDuration(r.durationMs),
    ]);

    console.log(renderTable(headers, rows));
  });

  // runs show <runId>
  const showCmd = new Command('show');
  showCmd.description('Show details of a specific evaluation run');
  showCmd.argument('<runId>', 'Run ID');

  showCmd.action(async (runId: string) => {
    const records = await readRunRecords();
    const record = records.find(r => r.runId === runId || r.runId.startsWith(runId));

    if (!record) {
      logger.error(`Evaluation run not found: ${runId}`);
      process.exit(1);
    }

    console.log(`Run ID:              ${record.runId}`);
    console.log(`Timestamp:           ${record.timestamp}`);
    console.log(`Time window:         ${record.since}`);
    console.log(`Evaluators:          ${record.metrics.join(', ')}`);
    console.log(`Spans evaluated:     ${record.spansEvaluated}`);
    console.log(`Results written:     ${record.resultsWritten}`);
    console.log(`Errors:              ${record.errors}`);
    console.log(`Threshold breaches:  ${record.thresholdBreaches}`);
    console.log(`Duration:            ${formatDuration(record.durationMs)}`);
  });

  // runs export
  const exportCmd = new Command('export');
  exportCmd.description('Export evaluation run history to JSON or CSV');
  exportCmd.option('--format <format>', 'Output format: json or csv', 'json');
  exportCmd.option('--output <path>', 'Output file path');

  exportCmd.action(async (options: { format: string; output?: string }) => {
    const records = await readRunRecords();

    let content: string;
    if (options.format === 'csv') {
      content = formatCsv(records);
    } else {
      content = JSON.stringify(records, null, 2);
    }

    if (options.output) {
      writeFileSync(options.output, content, 'utf-8');
      logger.success(`Exported ${records.length} evaluation runs to ${options.output}`);
    } else {
      console.log(content);
    }
  });

  cmd.addCommand(listCmd);
  cmd.addCommand(showCmd);
  cmd.addCommand(exportCmd);

  return cmd;
}
