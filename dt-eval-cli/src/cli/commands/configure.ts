import { Command } from 'commander';
import { join } from 'node:path';
import { loadConfig, saveConfig, validateConfig } from '../../config/index.js';
import type { DtEvalConfig } from '../../config/schema.js';
import { stringify as stringifyYaml } from 'yaml';
import { redactSecrets } from '../../ui/format.js';
import { logger } from '../../logger/index.js';
import { printBanner } from '../../ui/banner.js';
import { listPrompts, DRIFT_METRIC_ID } from 'dt-eval-lib';
import { DynatraceClient } from '../../dt/client.js';

// Per-million-token pricing [input, output] in USD
const MODEL_PRICING: Record<string, [number, number]> = {
  'gpt-4o':              [2.50,  10.00],
  'gpt-4o-mini':         [0.15,   0.60],
  'gpt-4.1':             [2.00,   8.00],
  'gpt-4.1-mini':        [0.40,   1.60],
  'o3':                  [10.00,  40.00],
  'o4-mini':             [1.10,   4.40],
  'claude-opus-4-6':     [15.00,  75.00],
  'claude-sonnet-4-6':   [3.00,  15.00],
  'claude-haiku-4-5':    [0.80,   4.00],
};
const FALLBACK_PRICING: [number, number] = [2.50, 10.00];

function estimateCost(
  estimatedSpans: number,
  samplePercent: number,
  metricCount: number,
  model: string,
): { sampledSpans: number; evalCalls: number; inferenceUsd: number; dtIngestUsd: number; totalUsd: number } {
  const [inputPricePer1M, outputPricePer1M] =
    MODEL_PRICING[model] ?? MODEL_PRICING[model.split('-').slice(0, 2).join('-')] ?? FALLBACK_PRICING;

  const sampledSpans = Math.max(1, Math.round(estimatedSpans * samplePercent / 100));
  const evalCalls = sampledSpans * metricCount;

  const inferenceUsd =
    (evalCalls * 900  / 1_000_000) * inputPricePer1M +
    (evalCalls * 200  / 1_000_000) * outputPricePer1M;

  const dtIngestUsd = (evalCalls * 1500 / (1024 ** 3)) * 0.20;

  return { sampledSpans, evalCalls, inferenceUsd, dtIngestUsd, totalUsd: inferenceUsd + dtIngestUsd };
}

function printCostEstimate(
  estimatedSpans: number | null,
  samplePercent: number,
  metrics: string[],
  model: string,
): void {
  const spansFallback = estimatedSpans ?? 500;
  const { sampledSpans, evalCalls, inferenceUsd, dtIngestUsd, totalUsd } =
    estimateCost(spansFallback, samplePercent, metrics.length, model);

  const pricingNote = MODEL_PRICING[model] ? model : `${model} (using GPT-4o pricing as baseline)`;
  const spansLabel = estimatedSpans != null ? `~${spansFallback}` : `~${spansFallback} (estimated)`;

  console.log('\n  ─── Cost estimate ───────────────────────────────');
  console.log(`  Spans in window:     ${spansLabel} → ~${sampledSpans} sampled (${samplePercent}%)`);
  console.log(`  Evaluation calls:    ~${evalCalls}  (${sampledSpans} spans × ${metrics.length} evaluators)`);
  console.log(`  LLM inference:       ~$${inferenceUsd.toFixed(4)}  (model: ${pricingNote})`);
  console.log(`  DT bizevent ingest:  ~$${dtIngestUsd.toFixed(5)}`);
  console.log(`  Total per run:       ~$${totalUsd.toFixed(4)}`);
  console.log('\n  ⚠  Ballpark only — token counts vary by span length and metric.');
  console.log('  Always monitor your actual inference costs in your provider dashboard.\n');
}

async function testServiceSpans(
  environmentUrl: string,
  apiToken: string,
  dtctlContext: string | undefined,
  serviceName: string,
): Promise<number | null> {
  try {
    const client = new DynatraceClient({ environmentUrl, apiToken, dtctlContext });
    const query = `fetch spans
| filter service.name == "${serviceName}" or dt.entity.service == "${serviceName}"
| filter isNotNull(gen_ai.provider.name)
| limit 1000
| summarize count = count()`;
    const records = await client.executeDql(query) as Array<Record<string, unknown>>;
    const count = records?.[0]?.['count'];
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
}

export function createConfigureCommand(): Command {
  const cmd = new Command('configure');
  cmd.description('Configure evaluation settings (interactive wizard or flags)');

  cmd.option('--env-url <url>', 'Dynatrace environment URL');
  cmd.option('--api-token <token>', 'Dynatrace API token');
  cmd.option('--provider <provider>', 'Judge provider (openai|anthropic)');
  cmd.option('--api-key <key>', 'Judge provider API key');
  cmd.option('--model <model>', 'Judge model override');
  cmd.option('--since <duration>', 'Default time window (e.g. 1h, 6h, 24h)');
  cmd.option('--show', 'Print current resolved config with secrets redacted');
  cmd.option('--output <path>', 'Output config file path (default: <name>.dt-eval.yaml or .dt-eval.yaml)');

  cmd.action(async (options: {
    envUrl?: string;
    apiToken?: string;
    provider?: string;
    apiKey?: string;
    model?: string;
    since?: string;
    show?: boolean;
    output?: string;
  }) => {
    if (options.show) {
      try {
        const config = loadConfig();
        const redacted = redactSecrets(config);
        console.log(stringifyYaml(redacted, { indent: 2 }));
      } catch (err) {
        logger.error(`Failed to load config: ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }

    const hasFlags = !!(
      options.envUrl ||
      options.apiToken ||
      options.provider ||
      options.apiKey ||
      options.model ||
      options.since
    );

    if (!hasFlags) printBanner();

    let existing: Partial<DtEvalConfig> = {};
    try {
      existing = loadConfig();
    } catch {
      // No existing config, start fresh
    }

    const availablePrompts = await listPrompts();
    // LLM-as-judge metrics from the lib + drift as a special population-level metric
    const allMetricIds = [...availablePrompts.map(p => p.id), DRIFT_METRIC_ID];

    if (!hasFlags) {
      let inquirer: typeof import('@inquirer/prompts');
      try {
        inquirer = await import('@inquirer/prompts');
      } catch {
        logger.error('@inquirer/prompts is required for interactive mode');
        process.exit(1);
      }

      const { input, password, select, checkbox } = inquirer;

      console.log('\n  dt-eval-cli setup wizard');
      console.log('  ' + '─'.repeat(30) + '\n');

      // ── Evaluation identity ──────────────────────────────
      const evalName = await input({
        message: 'Evaluation name  (e.g. "travel-advisor-prod", "chat-service-staging")',
        default: existing.name ?? '',
        validate: (v) => v.trim().length > 0 ? true : 'Name is required',
      });

      const outputPath = options.output ?? join(process.cwd(), `${evalName.trim()}.dt-eval.yaml`);

      // ── Dynatrace ────────────────────────────────────────
      const envUrl = await input({
        message: 'Dynatrace environment URL',
        default: existing.dynatrace?.environmentUrl ?? '',
      });

      const apiToken = await password({
        message: 'Dynatrace API token',
      });

      const dtctlContext = await input({
        message: 'dtctl context name for OAuth DQL  (leave blank to use API token)',
        default: existing.dynatrace?.dtctlContext ?? '',
      });

      // ── Service ──────────────────────────────────────────
      const serviceName = await input({
        message: 'Name of your AI app and service  (service.name in Dynatrace spans)',
        default: existing.scope?.service ?? '',
        validate: (v) => v.trim().length > 0 ? true : 'Service name is required',
      });

      process.stdout.write(`\n  Testing service "${serviceName}" — checking for LLM spans...`);
      const spanCount = await testServiceSpans(
        envUrl,
        apiToken || (existing.dynatrace?.apiToken ?? ''),
        dtctlContext || undefined,
        serviceName,
      );

      if (spanCount === null) {
        process.stdout.write(' ⚠  Could not query (check token / connectivity)\n');
      } else if (spanCount === 0) {
        process.stdout.write(` ⚠  No LLM spans found for "${serviceName}" in the last hour\n`);
        console.log('  (The service may have no recent activity, or span fields may differ)\n');
      } else {
        process.stdout.write(` ✓  Found ~${spanCount} LLM spans\n\n`);
      }

      // ── Evaluator provider ───────────────────────────────
      const provider = await select({
        message: 'Evaluator provider',
        choices: [
          { name: 'openai', value: 'openai' as const },
          { name: 'anthropic', value: 'anthropic' as const },
        ],
        default: existing.judge?.provider ?? 'openai',
      });

      const apiKey = await password({
        message: provider === 'openai' ? 'OpenAI API key' : 'Anthropic API key',
      });

      const model = await input({
        message: 'Evaluator model  (leave blank for provider default)',
        default: existing.judge?.model ?? '',
      });

      // ── Evaluators ───────────────────────────────────────
      const enabledMetrics = existing.metrics?.enabled ?? allMetricIds;
      const selectedMetrics = await checkbox({
        message: `Evaluators to run  (${allMetricIds.length - 1} built-in + drift detection)`,
        choices: [
          ...availablePrompts.map(p => ({ name: p.id, value: p.id, checked: enabledMetrics.includes(p.id) })),
          { name: `${DRIFT_METRIC_ID}  (population-level, compares score distributions vs 7d baseline)`, value: DRIFT_METRIC_ID, checked: enabledMetrics.includes(DRIFT_METRIC_ID) },
        ],
      });

      // ── Sampling ─────────────────────────────────────────
      const sampleStr = await input({
        message: 'Sampling — % of traces to evaluate per run  (range: 1–100, default 5 recommended to control costs)',
        default: String(existing.scope?.sampling?.percent ?? 5),
        validate: (v) => {
          const n = parseInt(v, 10);
          return (n >= 1 && n <= 100) ? true : 'Enter a number between 1 and 100';
        },
      });

      const since = await input({
        message: 'Default time window',
        default: existing.scope?.since ?? '1h',
      });

      const updated: DtEvalConfig = {
        schemaVersion: existing.schemaVersion ?? 1,
        name: evalName.trim(),
        dynatrace: {
          environmentUrl: envUrl,
          apiToken: apiToken || existing.dynatrace?.apiToken,
          ...(dtctlContext ? { dtctlContext } : {}),
        },
        judge: {
          provider,
          apiKey: apiKey || existing.judge?.apiKey,
          model: model || existing.judge?.model,
          timeout: existing.judge?.timeout ?? 30000,
          maxRetries: existing.judge?.maxRetries ?? 2,
        },
        scope: {
          service: serviceName.trim(),
          since,
          sampling: {
            strategy: 'random',
            percent: parseInt(sampleStr, 10),
          },
        },
        metrics: {
          enabled: selectedMetrics.length > 0 ? selectedMetrics : enabledMetrics,
        },
        alerts: existing.alerts,
      };

      try {
        validateConfig(updated);
      } catch (err) {
        logger.warn(`Config has validation issues — ${(err as Error).message}`);
        logger.warn('Config saved anyway. Run "dt-eval-cli validate" to check.');
      }

      try {
        saveConfig(updated, outputPath);
        logger.success(`Config saved to ${outputPath}`);
      } catch (err) {
        logger.error(`Failed to save config: ${(err as Error).message}`);
        process.exit(1);
      }

      printCostEstimate(
        spanCount != null && spanCount > 0 ? spanCount : null,
        parseInt(sampleStr, 10),
        updated.metrics.enabled,
        updated.judge.model ?? (updated.judge.provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6'),
      );

      return;
    }

    // ── Flag-only mode ────────────────────────────────────
    const updated: DtEvalConfig = {
      schemaVersion: existing.schemaVersion ?? 1,
      name: existing.name,
      dynatrace: {
        environmentUrl: options.envUrl ?? existing.dynatrace?.environmentUrl ?? '',
        apiToken: options.apiToken ?? existing.dynatrace?.apiToken,
      },
      judge: {
        provider: (options.provider as 'openai' | 'anthropic') ?? existing.judge?.provider ?? 'openai',
        apiKey: options.apiKey ?? existing.judge?.apiKey,
        model: options.model ?? existing.judge?.model,
        timeout: existing.judge?.timeout ?? 30000,
        maxRetries: existing.judge?.maxRetries ?? 2,
      },
      scope: existing.scope ?? {
        since: options.since ?? '1h',
        sampling: { strategy: 'random', percent: 5 },
      },
      metrics: existing.metrics ?? { enabled: allMetricIds },
      alerts: existing.alerts,
    };

    if (options.since) updated.scope.since = options.since;

    const outputPath = options.output ?? join(process.cwd(), updated.name ? `${updated.name}.dt-eval.yaml` : '.dt-eval.yaml');

    try {
      validateConfig(updated);
    } catch (err) {
      console.warn(`Warning: config has validation issues — ${(err as Error).message}`);
      console.warn('Config saved anyway. Run "dt-eval-cli validate" to check.');
    }

    try {
      saveConfig(updated, outputPath);
      console.log(`Config saved to ${outputPath}`);
    } catch (err) {
      console.error(`Failed to save config: ${(err as Error).message}`);
      process.exit(1);
    }
  });

  return cmd;
}
