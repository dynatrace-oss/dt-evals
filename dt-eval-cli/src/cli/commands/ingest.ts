import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../config/index.js';
import { resolveEndpoints } from '../../config/schema.js';
import { DynatraceClient } from '../../dt/client.js';
import { buildRagasBizevents } from '../../ragas/ingest.js';
import { logger } from '../../logger/index.js';

export function createIngestCommand(): Command {
  const cmd = new Command('ingest');
  cmd.description('Ingest external evaluation results into Dynatrace');

  const ragas = new Command('ragas');
  ragas
    .description('Ingest Ragas EvaluationResult JSON exported as row-oriented records')
    .argument('<file>', 'JSON exported from Ragas EvaluationResult')
    .option('--config <path>', 'Path to configuration file')
    .option('--run-id <id>', 'Evaluation run identifier')
    .option('--store-evaluated-input', 'Include Ragas user_input and response in bizevents')
    .option('--dry-run', 'Validate and show the event count without ingesting')
    .action(async (
      file: string,
      options: { config?: string; runId?: string; storeEvaluatedInput?: boolean; dryRun?: boolean },
    ) => {
      const config = loadConfig({ projectFile: options.config });
      const { destination } = resolveEndpoints(config.dynatrace);
      if (!destination.environmentUrl) {
        throw new Error('Dynatrace destination URL is required (set DT_ENV_URL or dynatrace.environmentUrl)');
      }
      if (!destination.apiToken && !options.dryRun) {
        throw new Error('Dynatrace destination token is required (set DT_API_TOKEN or dynatrace.apiToken)');
      }

      const runId = options.runId ?? `ragas-${randomUUID()}`;
      const result = await buildRagasBizevents(file, {
        runId,
        storeEvaluatedInput: options.storeEvaluatedInput ?? false,
      });

      if (!options.dryRun) {
        await new DynatraceClient(destination).ingestBizevents(result.events);
      }

      logger.success(
        `${options.dryRun ? 'Validated' : 'Ingested'} ${result.metricsRead} Ragas metric result(s) from ${result.rowsRead} row(s) with run ID ${runId}`,
      );
    });

  cmd.addCommand(ragas);
  return cmd;
}
