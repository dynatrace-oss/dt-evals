import { Command } from 'commander';
import { loadConfig, validateConfig } from '../../config/index.js';
import { resolveEndpoints, metricId } from '../../config/schema.js';
import { DynatraceClient } from '../../dt/client.js';
import { runEvals, type RunProgressEvent } from '../../runner/index.js';
import { Spinner } from '../../ui/spinner.js';
import { renderTable } from '../../ui/table.js';
import { formatDuration } from '../../ui/format.js';
import { logger, configureLogger } from '../../logger/index.js';

/**
 * Map runner progress events onto a single live spinner so the visible label
 * matches the work actually in flight (fetch → evaluate → write), and so each
 * completed phase prints a one-line summary with timing.
 */
function buildSpinnerProgress(spinner: Spinner): (event: RunProgressEvent) => void {
  return (event) => {
    switch (event.phase) {
      case 'fetching':
        spinner.update('Fetching GenAI spans from Dynatrace...');
        break;
      case 'fetched':
        spinner.succeed(`Fetched ${event.spans} span${event.spans === 1 ? '' : 's'} in ${formatDuration(event.durationMs)}`);
        spinner.start('Sampling and masking spans...');
        break;
      case 'evaluating-start':
        spinner.update(`Evaluating 0/${event.tasks} (${event.spans} span${event.spans === 1 ? '' : 's'} × ${event.metrics} metric${event.metrics === 1 ? '' : 's'})...`);
        break;
      case 'eval-completed': {
        const shortTrace = event.traceId.slice(0, 8);
        const tag = event.error ? '✗' : '•';
        spinner.update(`Evaluating ${event.completed}/${event.total} ${tag} ${event.metric} trace=${shortTrace}…`);
        break;
      }
      case 'evaluating-done': {
        const errSuffix = event.errors > 0 ? ` (${event.errors} error${event.errors === 1 ? '' : 's'})` : '';
        spinner.succeed(`Evaluated ${event.tasks} task${event.tasks === 1 ? '' : 's'} in ${formatDuration(event.durationMs)}${errSuffix}`);
        break;
      }
      case 'writing':
        spinner.start(`Writing ${event.payloads} result${event.payloads === 1 ? '' : 's'} to Dynatrace...`);
        break;
      case 'written':
        spinner.succeed(`Wrote ${event.payloads} result${event.payloads === 1 ? '' : 's'} in ${formatDuration(event.durationMs)}`);
        break;
      case 'preparing':
        // Sampling and masking are sub-millisecond; intentionally don't emit
        // a separate "succeed" line for them — `evaluating-start` is the next
        // visible phase.
        break;
    }
  };
}

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
  // No default — when omitted, runEvals falls back to scope.since from the
  // yaml. A CLI default would silently override a yaml `since: 24h`.
  cmd.option('--since <duration>', 'Time window for trace fetch (e.g. 1h, 6h, 24h). Falls back to scope.since in the config when omitted.');
  cmd.option('--sample <percent>', 'Override sampling: percentage of traces to evaluate (0-100). When omitted, uses the strategy from your config file.', parseFloat);
  cmd.option('--metric <name>', 'Run a specific evaluator only');
  cmd.option('--dry-run', 'Fetch and transform traces, print payloads, do not send');
  cmd.option('--ci', 'Non-interactive mode: JSON stdout, exit 1 on threshold breach');
  cmd.option('--concurrency <n>', 'Number of parallel evaluation workers (overrides judge.concurrency in the config; default 5)', (v) => parseInt(v, 10));
  cmd.option('--store-evaluated-prompt', 'Include the evaluated prompt/response in bizevents written to Dynatrace (overrides storeEvaluatedPrompt in the config; default: false)');
  cmd.option('--debug', 'Enable debug logging with per-step timing');

  cmd.action(async (configArg: string | undefined, options: {
    config?: string;
    since?: string;
    sample: number;
    metric?: string;
    dryRun?: boolean;
    ci?: boolean;
    concurrency?: number;
    storeEvaluatedPrompt?: boolean;
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
      logger.error('Run "dt-evals configure" to set up your configuration.');
      process.exit(1);
    }

    const { origin, destination } = resolveEndpoints(config.dynatrace);
    const missing: string[] = [];
    if (!origin.apiToken) missing.push('origin (set DT_ORIGIN_API_TOKEN or dynatrace.origin.apiToken / DT_API_TOKEN)');
    if (!destination.apiToken) missing.push('destination (set DT_DESTINATION_API_TOKEN or dynatrace.destination.apiToken / DT_API_TOKEN)');
    if (missing.length > 0) {
      const msg = `Authentication required for: ${missing.join('; ')}`;
      if (options.ci) {
        console.log(JSON.stringify({ error: msg }));
      } else {
        logger.error(msg);
      }
      process.exit(1);
    }

    const dtClients = {
      origin: new DynatraceClient({ environmentUrl: origin.environmentUrl, apiToken: origin.apiToken }),
      destination: new DynatraceClient({ environmentUrl: destination.environmentUrl, apiToken: destination.apiToken }),
    };
    if (origin.environmentUrl !== destination.environmentUrl) {
      logger.info(`Cross-tenant: read ${origin.environmentUrl} → write ${destination.environmentUrl}`);
    }

    const spinner = options.ci ? null : new Spinner('Fetching GenAI spans from Dynatrace...');
    spinner?.start();

    const onProgress = spinner ? buildSpinnerProgress(spinner) : undefined;

    try {
      const result = await runEvals(dtClients, config, {
        since: options.since,
        sample: options.sample,
        metrics: options.metric ? [options.metric] : undefined,
        dryRun: options.dryRun,
        ci: options.ci,
        concurrency: options.concurrency ?? config.judge.concurrency,
        storeEvaluatedPrompt: options.storeEvaluatedPrompt,
        onProgress,
      });

      if (options.dryRun) {
        spinner?.succeed(`Dry run complete in ${formatDuration(result.durationMs)}`);
      } else {
        // Each phase already emitted its own success line via onProgress; just
        // clear any in-flight spinner.
        spinner?.stop();
      }

      if (!options.ci && !options.dryRun) {
        const metrics = options.metric ? [options.metric] : config.metrics.enabled.map(metricId);

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
