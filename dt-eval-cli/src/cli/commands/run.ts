import { Command } from 'commander';
import { loadConfig, validateConfig } from '../../config/index.js';
import { DynatraceClient } from '../../dt/client.js';
import { runEvals } from '../../runner/index.js';
import { Spinner } from '../../ui/spinner.js';
import { renderTable } from '../../ui/table.js';
import { formatDuration } from '../../ui/format.js';
import { logger, configureLogger } from '../../logger/index.js';

export function createRunCommand(): Command {
  const cmd = new Command('run');
  cmd.description('Run evaluations against recent GenAI traces from Dynatrace');

  cmd.option('--config <path>', 'Path to eval config file (e.g. travel-advisor.dt-eval.yaml)');
  cmd.option('--since <duration>', 'Time window for trace fetch (e.g. 1h, 6h, 24h)', '1h');
  cmd.option('--sample <percent>', 'Percentage of traces to evaluate (0-100)', parseFloat, 100);
  cmd.option('--metric <name>', 'Run a specific evaluator only');
  cmd.option('--dry-run', 'Fetch and transform traces, print payloads, do not send');
  cmd.option('--ci', 'Non-interactive mode: JSON stdout, exit 1 on threshold breach');
  cmd.option('--concurrency <n>', 'Number of parallel evaluation workers', (v) => parseInt(v, 10), 5);
  cmd.option('--debug', 'Enable debug logging with per-step timing');

  cmd.action(async (options: {
    config?: string;
    since: string;
    sample: number;
    metric?: string;
    dryRun?: boolean;
    ci?: boolean;
    concurrency: number;
    debug?: boolean;
  }) => {
    if (options.debug) {
      configureLogger({ level: 'debug' });
    }
    let config;
    try {
      config = loadConfig(options.config ? { projectFile: options.config } : undefined);
      validateConfig(config);
    } catch (err) {
      if (options.ci) {
        console.log(JSON.stringify({ error: (err as Error).message }));
        process.exit(1);
      }
      logger.error(`Config error: ${(err as Error).message}`);
      logger.error('Run "dt-eval-cli configure" to set up your configuration.');
      process.exit(1);
    }

    const apiToken = config.dynatrace.apiToken;
    if (!apiToken) {
      const msg = 'dynatrace.apiToken is required. Set DT_API_TOKEN env var or configure it.';
      if (options.ci) {
        console.log(JSON.stringify({ error: msg }));
      } else {
        logger.error(msg);
      }
      process.exit(1);
    }

    const dtClient = new DynatraceClient({
      environmentUrl: config.dynatrace.environmentUrl,
      apiToken,
      dtctlContext: config.dynatrace.dtctlContext,
    });

    const spinner = options.ci ? null : new Spinner('Fetching GenAI spans from Dynatrace...');
    spinner?.start();

    try {
      const result = await runEvals(dtClient, config, {
        since: options.since,
        sample: options.sample,
        metrics: options.metric ? [options.metric] : undefined,
        dryRun: options.dryRun,
        ci: options.ci,
        concurrency: options.concurrency,
      });

      spinner?.succeed(`Evaluation run complete in ${formatDuration(result.durationMs)}`);

      if (!options.ci && !options.dryRun) {
        const metrics = options.metric ? [options.metric] : config.metrics.enabled;

        console.log('\nEvaluation results:');
        const headers = ['Evaluator', 'Results', 'Errors', 'Duration'];
        const rows = metrics.map(m => [
          m,
          String(Math.floor(result.resultsWritten / metrics.length)),
          String(result.errors > 0 ? Math.ceil(result.errors / metrics.length) : 0),
          formatDuration(result.durationMs),
        ]);
        console.log(renderTable(headers, rows));

        console.log(`\nRun ${result.runId} complete in ${formatDuration(result.durationMs)}`);
        console.log(`${result.resultsWritten} evaluation results written to Dynatrace`);

        if (result.thresholdBreaches.length > 0) {
          logger.warn(`Threshold breaches: ${result.thresholdBreaches.length}`);
          for (const breach of result.thresholdBreaches) {
            logger.warn(`  - ${breach.metric} [${breach.traceId}]: score=${breach.score}`);
          }
        }
      }

      if (options.ci && result.thresholdBreaches.length > 0) {
        process.exit(1);
      }
    } catch (err) {
      const msg = (err as Error).message;
      spinner?.fail(`Evaluation run failed: ${msg}`);
      if (options.ci) {
        console.log(JSON.stringify({ error: msg }));
      } else {
        logger.error(`Evaluation run failed: ${msg}`);
      }
      process.exit(1);
    }
  });

  return cmd;
}
