import { Command } from 'commander';
import { loadConfig, validateConfig } from '../../config/index.js';
import { DEFAULT_JUDGE_MODELS } from '../../config/defaults.js';
import { DynatraceClient } from '../../dt/client.js';
import { listPrompts } from 'dt-eval-lib';
import { logger } from '../../logger/index.js';

async function testDynatraceConnection(environmentUrl: string, apiToken: string): Promise<boolean> {
  try {
    const client = new DynatraceClient({ environmentUrl, apiToken });
    await client.executeDql('fetch logs | limit 1');
    return true;
  } catch {
    return false;
  }
}

async function testAiProvider(
  provider: string,
  apiKey?: string,
  model?: string,
  options?: { baseUrl?: string; region?: string },
): Promise<{ ok: boolean; model?: string }> {
  const resolvedModel = model ?? DEFAULT_JUDGE_MODELS[provider] ?? 'unknown';
  try {
    if (provider === 'openai') {
      const key = apiKey ?? process.env['OPENAI_API_KEY'];
      if (!key) return { ok: false };
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      return { ok: response.ok, model: resolvedModel };
    } else if (provider === 'anthropic') {
      const key = apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (!key) return { ok: false };
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
      });
      return { ok: response.ok, model: resolvedModel };
    } else if (provider === 'azure-openai') {
      const key = apiKey ?? process.env['AZURE_OPENAI_API_KEY'];
      const endpoint = options?.baseUrl ?? process.env['AZURE_OPENAI_ENDPOINT'];
      if (!key || !endpoint) return { ok: false };
      // Probe the Azure OpenAI models list endpoint
      const url = `${endpoint.replace(/\/$/, '')}/openai/models?api-version=2024-02-01`;
      const response = await fetch(url, {
        headers: { 'api-key': key },
        signal: AbortSignal.timeout(8000),
      });
      return { ok: response.ok, model: resolvedModel };
    } else if (provider === 'gemini') {
      const key = apiKey ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
      if (!key) return { ok: false };
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
        { signal: AbortSignal.timeout(8000) },
      );
      return { ok: response.ok, model: resolvedModel };
    } else if (provider === 'bedrock') {
      // Cannot probe Bedrock without the SDK + signing — just check AWS env vars are set
      const hasCredentials =
        !!(process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY']) ||
        !!(process.env['AWS_ROLE_ARN']) ||
        !!(options?.region ?? process.env['AWS_REGION']);
      return { ok: hasCredentials, model: resolvedModel };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export function createValidateCommand(): Command {
  const cmd = new Command('validate');
  cmd.description('Run pre-flight checks on config, connectivity, and evaluator keys');

  cmd.action(async () => {
    console.log('Running pre-flight checks...\n');

    let config;
    let configValid = false;

    // 1. Schema validation
    try {
      config = loadConfig();
      validateConfig(config);
      configValid = true;
      logger.success('Config schema valid');
    } catch (err) {
      logger.error(`Config schema invalid: ${(err as Error).message}`);
    }

    if (!config) {
      console.log('\nCannot proceed without valid config.');
      process.exit(1);
    }

    // 2. DT connection
    const apiToken = config.dynatrace.apiToken;
    if (!apiToken) {
      logger.error('Dynatrace API token not set');
    } else {
      process.stdout.write('');
      const dtOk = await testDynatraceConnection(config.dynatrace.environmentUrl, apiToken);
      if (dtOk) {
        logger.success(`Dynatrace connection  (${config.dynatrace.environmentUrl})`);
      } else {
        logger.error(`Dynatrace connection failed  (${config.dynatrace.environmentUrl})`);
      }
    }

    // 3. AI provider
    const { ok: aiOk, model: aiModel } = await testAiProvider(
      config.judge.provider,
      config.judge.apiKey,
      config.judge.model,
      { baseUrl: config.judge.baseUrl, region: config.judge.region },
    );
    if (aiOk) {
      logger.success(`Evaluator provider reachable  (${config.judge.provider}, model: ${aiModel ?? 'unknown'})`);
    } else {
      logger.error(`Evaluator provider unreachable or API key invalid  (${config.judge.provider})`);
    }

    // 4. Evaluators
    try {
      const prompts = await listPrompts();
      const builtIn = prompts.filter(p => !((p as Record<string, unknown>)['custom']));
      const custom = prompts.filter(p => (p as Record<string, unknown>)['custom']);
      logger.success(`${builtIn.length} built-in evaluators available`);
      logger.success(`${custom.length} custom evaluators loaded`);
    } catch (err) {
      logger.error(`Failed to load evaluators: ${(err as Error).message}`);
    }

    if (configValid) {
      console.log('\nAll checks passed. Ready to run evaluations.');
    } else {
      console.log('\nSome checks failed. Run "dt-eval-cli configure" to fix issues.');
      process.exit(1);
    }
  });

  return cmd;
}
