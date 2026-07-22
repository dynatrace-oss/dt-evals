import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { loadConfig, saveConfig, validateConfig } from '../../config/index.js';
import { updateEnvFile } from '../../config/env-file.js';
import type { DtEvalConfig } from '../../config/schema.js';
import { metricId } from '../../config/schema.js';
import { DEFAULT_JUDGE_MODELS, suggestModelForProvider } from '../../config/defaults.js';
import { stringify as stringifyYaml } from 'yaml';
import { redactSecrets } from '../../ui/format.js';
import { logger } from '../../logger/index.js';
import { printBanner } from '../../ui/banner.js';
import { listPrompts, DRIFT_METRIC_ID } from '@dynatrace-oss/dt-eval-lib';
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
  // Azure OpenAI — same as upstream OpenAI pricing
  'gpt-4o (azure)':      [2.50,  10.00],
  // Gemini
  'gemini-2.0-flash':    [0.10,   0.40],
  'gemini-1.5-pro':      [3.50,  10.50],
  'gemini-1.5-flash':    [0.075,  0.30],
  // Bedrock (Claude via Bedrock)
  'anthropic.claude-sonnet-4-5-20251001-v1:0': [3.00, 15.00],
  'anthropic.claude-haiku-3-5-20241022-v1:0':  [0.80,  4.00],
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

/**
 * Env var name that holds the API key for each provider, matching the fallbacks
 * in applyEnvVars(). Vertex is intentionally absent — it uses ADC / Workload
 * Identity and needs no key.
 */
const PROVIDER_KEY_ENV: Partial<Record<DtEvalConfig['judge']['provider'], string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  'azure-openai': 'AZURE_OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  bedrock: 'AWS_ACCESS_KEY_ID',
};

/**
 * Collect the effective secrets from the resolved config into `.env` variable
 * names. This preserves existing working credentials when a user re-runs
 * `configure` without re-entering every secret, so stripping YAML secrets does
 * not silently break the config.
 */
function collectSecretEnv(config: DtEvalConfig): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.dynatrace.apiToken) env['DT_API_TOKEN'] = config.dynatrace.apiToken;
  if (config.dynatrace.origin?.apiToken) env['DT_ORIGIN_API_TOKEN'] = config.dynatrace.origin.apiToken;
  if (config.dynatrace.destination?.apiToken) env['DT_DESTINATION_API_TOKEN'] = config.dynatrace.destination.apiToken;

  const keyEnv = PROVIDER_KEY_ENV[config.judge.provider];
  if (keyEnv && config.judge.apiKey) env[keyEnv] = config.judge.apiKey;
  if (config.judge.provider === 'bedrock' && config.judge.secretKey) {
    env['AWS_SECRET_ACCESS_KEY'] = config.judge.secretKey;
  }

  return env;
}

/**
 * Persist secrets to cwd `.env` (gitignored) and tell the user which names to
 * wire up as CI/CD pipeline secrets. No-op when nothing is configured.
 */
function persistSecretsToEnv(config: DtEvalConfig, log: (msg: string) => void): void {
  const secretEnv = collectSecretEnv(config);
  if (Object.keys(secretEnv).length === 0) return;
  const envPath = join(process.cwd(), '.env');
  updateEnvFile(envPath, secretEnv);
  log(`Secrets written to ${envPath} (gitignored) — kept out of the config file`);
  log(`For CI/CD, set these as pipeline secrets instead: ${Object.keys(secretEnv).join(', ')}`);
}

export function resolveConfiguredApiKey(
  existing: Partial<DtEvalConfig['judge']> | undefined,
  provider: DtEvalConfig['judge']['provider'],
  enteredApiKey: string | undefined,
  opts?: { preserveExistingVertexKey?: boolean },
): string | undefined {
  if (enteredApiKey) {
    return enteredApiKey;
  }

  if (provider !== existing?.provider) {
    return undefined;
  }

  if (provider === 'vertex' && !opts?.preserveExistingVertexKey) {
    return undefined;
  }

  return existing.apiKey;
}

async function testServiceSpans(
  environmentUrl: string,
  apiToken: string,
  serviceName: string,
): Promise<number | null> {
  try {
    const client = new DynatraceClient({ environmentUrl, apiToken });
    const query = `fetch spans
| filter service.name == "${serviceName}" or dt.smartscape.service == "${serviceName}"
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
  cmd.option('--provider <provider>', 'Judge provider (openai|anthropic|azure-openai|gemini|vertex|bedrock)');
  cmd.option('--api-key <key>', 'Judge provider API key');
  cmd.option('--model <model>', 'Judge model override');
  cmd.option('--project <project>', 'Vertex AI GCP project ID');
  cmd.option('--location <location>', 'Vertex AI location (for example global or us-central1)');
  cmd.option('--since <duration>', 'Default time window (e.g. 1h, 6h, 24h)');
  cmd.option('--show', 'Print current resolved config with secrets redacted');
  cmd.option('--output <path>', 'Output config file path (default: <name>.dt-eval.yaml or .dt-eval.yaml)');

  cmd.action(async (options: {
    envUrl?: string;
    apiToken?: string;
    provider?: string;
    apiKey?: string;
    model?: string;
    project?: string;
    location?: string;
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
      options.project ||
      options.location ||
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
    // Built-in evaluators from the lib + drift as a special population-level evaluator
    const allMetricIds = [...availablePrompts.map(p => p.id), DRIFT_METRIC_ID];

    if (!hasFlags) {
      let inquirer: typeof import('@inquirer/prompts');
      try {
        inquirer = await import('@inquirer/prompts');
      } catch {
        logger.error('@inquirer/prompts is required for interactive mode');
        process.exit(1);
      }

      const { input, password, select, checkbox, confirm } = inquirer;

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
        message: 'Dynatrace API token  (run "dt-evals doctor" to generate one)',
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
          { name: 'openai       — OpenAI API (GPT models)', value: 'openai' as const },
          { name: 'anthropic    — Anthropic API (Claude models)', value: 'anthropic' as const },
          { name: 'azure-openai — Azure OpenAI deployment', value: 'azure-openai' as const },
          { name: 'gemini       — Google Gemini API', value: 'gemini' as const },
          { name: 'vertex       — Vertex AI (ADC / Workload Identity by default)', value: 'vertex' as const },
          { name: 'bedrock      — AWS Bedrock (uses AWS credential chain)', value: 'bedrock' as const },
        ],
        default: existing.judge?.provider ?? 'openai',
      });

      const providerApiKeyLabel: Record<string, string> = {
        openai: 'OpenAI API key',
        anthropic: 'Anthropic API key',
        'azure-openai': 'Azure OpenAI API key (AZURE_OPENAI_API_KEY)',
        gemini: 'Gemini API key (GEMINI_API_KEY or GOOGLE_API_KEY)',
        vertex: 'Vertex AI API key (optional — leave blank to use ADC / Workload Identity)',
        bedrock: 'AWS Access Key ID — leave blank to rely on AWS_ACCESS_KEY_ID env var / IAM role',
      };
      const existingProviderApiKey = resolveConfiguredApiKey(existing.judge, provider, undefined);

      let apiKey: string;
      let bedrockSecretKey = '';
      let bedrockRegion = '';
      let azureBaseUrl = '';
      let azureApiVersion = '';
      let vertexProject = '';
      let vertexLocation = '';

      if (provider === 'bedrock') {
        apiKey = await input({
          message: providerApiKeyLabel[provider],
          default: existingProviderApiKey ?? '',
        });
        bedrockSecretKey = await password({
          message: 'AWS Secret Access Key — leave blank to rely on AWS_SECRET_ACCESS_KEY env var',
          mask: '*',
        });
        bedrockRegion = await input({
          message: 'AWS region (e.g. us-east-1)',
          default: existing.judge?.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
        });
      } else if (provider === 'azure-openai') {
        apiKey = await password({
          message: providerApiKeyLabel[provider] ?? `${provider} API key`,
        });
        azureBaseUrl = await input({
          message: 'Azure OpenAI endpoint URL (e.g. https://my-resource.openai.azure.com/)',
          default: existing.judge?.baseUrl ?? process.env['AZURE_OPENAI_ENDPOINT'] ?? '',
        });
        azureApiVersion = await input({
          message: 'Azure OpenAI API version (e.g. 2025-04-01-preview)',
          default:
            existing.judge?.apiVersion ??
            process.env['AZURE_OPENAI_API_VERSION'] ??
            '2025-04-01-preview',
        });
      } else if (provider === 'vertex') {
        apiKey = await password({
          message: providerApiKeyLabel[provider] ?? `${provider} API key`,
        });
        vertexProject = await input({
          message: 'GCP project ID',
          default:
            existing.judge?.project ??
            process.env['GOOGLE_CLOUD_PROJECT'] ??
            process.env['GCLOUD_PROJECT'] ??
            process.env['GCP_PROJECT_ID'] ??
            '',
        });
        vertexLocation = await input({
          message: 'Vertex AI location (for example global or us-central1)',
          default: existing.judge?.location ?? process.env['GOOGLE_CLOUD_LOCATION'] ?? 'global',
        });
      } else {
        apiKey = await password({
          message: providerApiKeyLabel[provider] ?? `${provider} API key`,
        });
      }

      const modelPlaceholder =
        provider === 'azure-openai'
          ? 'Required: enter your Azure deployment name (e.g. my-gpt4-deployment)'
          : 'Leave blank for provider default';

      const model = await input({
        message: `Evaluator model  (${modelPlaceholder})`,
        default: suggestModelForProvider(provider, existing.judge?.provider, existing.judge?.model),
      });

      const resolvedApiKey = resolveConfiguredApiKey(existing.judge, provider, apiKey);

      // ── Evaluators ───────────────────────────────────────
      const enabledMetricIds = (existing.metrics?.enabled ?? allMetricIds).map(metricId);
      const selectedMetrics = await checkbox({
        message: `Evaluators to run  (${allMetricIds.length - 1} built-in + drift detection)`,
        choices: [
          ...availablePrompts.map(p => ({ name: p.id, value: p.id, checked: enabledMetricIds.includes(p.id) })),
          { name: `${DRIFT_METRIC_ID}  (population-level, compares score distributions vs 7d baseline)`, value: DRIFT_METRIC_ID, checked: enabledMetricIds.includes(DRIFT_METRIC_ID) },
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
        },
        judge: {
          provider,
          ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
          ...(provider === 'bedrock' && {
            secretKey: bedrockSecretKey || existing.judge?.secretKey,
            region: bedrockRegion || existing.judge?.region,
          }),
          ...(provider === 'azure-openai' && {
            baseUrl: azureBaseUrl || existing.judge?.baseUrl,
            apiVersion: azureApiVersion || existing.judge?.apiVersion,
          }),
          ...(provider === 'vertex' && {
            project: vertexProject || existing.judge?.project,
            location: vertexLocation || existing.judge?.location,
          }),
          // Never carry over another provider's model (e.g. the OpenAI default
          // that resolveEffectiveConfig injects). Fall back to this provider's
          // default, or undefined when it has none (azure-openai deployments).
          model: model || suggestModelForProvider(provider, existing.judge?.provider, existing.judge?.model) || undefined,
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
          enabled: selectedMetrics.length > 0 ? selectedMetrics : enabledMetricIds,
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
        persistSecretsToEnv(updated, (msg) => logger.info(msg));
      } catch (err) {
        logger.error(`Failed to save config: ${(err as Error).message}`);
        process.exit(1);
      }

      printCostEstimate(
        spanCount != null && spanCount > 0 ? spanCount : null,
        parseInt(sampleStr, 10),
        updated.metrics.enabled.map(metricId),
        updated.judge.model ?? DEFAULT_JUDGE_MODELS[updated.judge.provider] ?? 'gpt-4o',
      );

      const runNow = await confirm({
        message: 'Would you like to run this right now?',
        default: true,
      });

      if (runNow) {
        console.log(`\n  Running: dt-evals run ${basename(outputPath)}\n`);
        spawnSync(process.execPath, [process.argv[1], 'run', outputPath], { stdio: 'inherit' });
      } else {
        console.log(`  Copy this to run the newly created config:`);
        console.log(`  dt-evals run ${basename(outputPath)}\n`);
      }

      return;
    }

    // ── Flag-only mode ────────────────────────────────────
    const provider = (options.provider as DtEvalConfig['judge']['provider']) ?? existing.judge?.provider ?? 'openai';
    const preserveExistingVertexKey = !(
      options.provider === 'vertex' ||
      options.project !== undefined ||
      options.location !== undefined ||
      options.apiKey !== undefined
    );
    const resolvedApiKey = resolveConfiguredApiKey(existing.judge, provider, options.apiKey, {
      preserveExistingVertexKey,
    });

    const updated: DtEvalConfig = {
      schemaVersion: existing.schemaVersion ?? 1,
      name: existing.name,
      dynatrace: {
        environmentUrl: options.envUrl ?? existing.dynatrace?.environmentUrl ?? '',
        apiToken: options.apiToken ?? existing.dynatrace?.apiToken,
      },
      judge: {
        provider,
        ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
        // Don't inherit another provider's model (e.g. the OpenAI default that
        // resolveEffectiveConfig injects) when switching providers via --provider.
        model: options.model ?? (suggestModelForProvider(provider, existing.judge?.provider, existing.judge?.model) || undefined),
        project: options.project ?? existing.judge?.project,
        location: options.location ?? existing.judge?.location,
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
      console.warn('Config saved anyway. Run "dt-evals validate" to check.');
    }

    try {
      saveConfig(updated, outputPath);
      console.log(`Config saved to ${outputPath}`);
      persistSecretsToEnv(updated, (msg) => console.log(msg));
      console.log(`\n  Copy this to run the newly created config:`);
      console.log(`  dt-evals run ${basename(outputPath)}\n`);
    } catch (err) {
      console.error(`Failed to save config: ${(err as Error).message}`);
      process.exit(1);
    }
  });

  return cmd;
}
