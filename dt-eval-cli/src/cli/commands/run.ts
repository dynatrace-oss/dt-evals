import { Command } from 'commander';
import { loadConfig, validateConfig } from '../../config/index.js';
import { DynatraceClient } from '../../dt/client.js';
import { runEvals } from '../../runner/index.js';
import { Spinner } from '../../ui/spinner.js';
import { renderTable } from '../../ui/table.js';
import { formatDuration } from '../../ui/format.js';
import { logger, configureLogger } from '../../logger/index.js';

function evalErrorHint(messages: string[]): string | null {
  const combined = messages.join(' ').toLowerCase();
  if (/model.*not.*exist|no such model|invalid model|unknown model/.test(combined))
    return 'Hint: the judge model name is invalid. Check judge.model in your config (e.g. gpt-4o, gpt-4o-mini, claude-sonnet-4-6).';
  if (/401|unauthorized|invalid.*api.*key|incorrect.*api.*key|api key/.test(combined))
    return 'Hint: API key rejected. Check judge.apiKey in your config or the relevant env var for your provider.';
  if (/429|rate.?limit|quota/.test(combined))
    return 'Hint: rate limit hit. Try reducing --sample or --concurrency.';
  if (/econnrefused|network|timeout|enotfound/.test(combined))
    return 'Hint: network error reaching the judge provider. Check your internet connection and judge.baseUrl if set.';
  if (/context.*length|maximum.*token|too.*long/.test(combined))
    return 'Hint: input too long for the model. Try a model with a larger context window.';
  return null;
}

export function createRunCommand(): Command {
  const cmd = new Command('run');
  cmd.description('Run evaluations against recent GenAI traces from Dynatrace');

  cmd.argument('[config]', 'Path to eval config file (e.g. travel-advisor.dt-eval.yaml)');
  cmd.option('--config <path>', 'Path to eval config file (alias for positional argument)');
  cmd.option('--since <duration>', 'Time window for trace fetch (e.g. 1h, 6h, 24h)', '1h');
  cmd.option('--sample <percent>', 'Percentage of traces to evaluate (0-100)', parseFloat, 100);
  cmd.option('--metric <name>', 'Run a specific evaluator only');
  cmd.option('--dry-run', 'Fetch and transform traces, print payloads, do not send');
  cmd.option('--ci', 'Non-interactive mode: JSON stdout, exit 1 on threshold breach');
  cmd.option('--concurrency <n>', 'Number of parallel evaluation workers', (v) => parseInt(v, 10), 5);
  cmd.option('--debug', 'Enable debug logging with per-step timing');

  cmd.action(async (configArg: string | undefined, options: {
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
    const configPath = configArg ?? options.config;
    let config;
    try {
      config = loadConfig(configPath ? { projectFile: configPath } : undefined);
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
    const dtctlContext = config.dynatrace.dtctlContext;
    if (!apiToken && !dtctlContext) {
      const msg = 'Authentication required: set dynatrace.apiToken, DT_API_TOKEN env var, or configure a dtctlContext.';
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
      dtctlContext,
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

        if (result.errors > 0 && result.errorSamples.length > 0) {
          logger.warn(`\n${result.errors} evaluation(s) failed. Sample errors:`);
          for (const msg of result.errorSamples) {
            logger.warn(`  • ${msg}`);
          }
          const hint = evalErrorHint(result.errorSamples);
          if (hint) logger.warn(`\n  ${hint}`);
        }

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
