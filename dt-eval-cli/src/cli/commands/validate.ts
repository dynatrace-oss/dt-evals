import { Command } from 'commander';
import { loadConfig, validateConfig } from '../../config/index.js';
import { DynatraceClient } from '../../dt/client.js';
import { resolveEndpoints } from '../../config/schema.js';
import { listPrompts } from '@dynatrace-oss/dt-eval-lib';
import { logger } from '../../logger/index.js';
import { probeProvider } from '../../probe/provider.js';

async function testDynatraceConnection(environmentUrl: string, apiToken: string): Promise<boolean> {
  try {
    const client = new DynatraceClient({ environmentUrl, apiToken });
    await client.executeDql('fetch logs | limit 1');
    return true;
  } catch {
    return false;
  }
}

async function probeOriginSpansRead(
  environmentUrl: string,
  apiToken: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const client = new DynatraceClient({ environmentUrl, apiToken });
    return await client.probeBucketRead('spans');
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

// Thin wrapper around the shared probe so validate and doctor agree on what
// "provider reachable" means: a real 1-token inference call with the configured
// model, so wrong model ids / wrong regions surface here instead of at runtime.
async function testAiProvider(
  provider: string,
  apiKey?: string,
  model?: string,
  options?: { baseUrl?: string; region?: string; apiVersion?: string; secretKey?: string },
): Promise<{ ok: boolean; model: string; error?: string }> {
  return probeProvider({
    provider,
    apiKey,
    model,
    baseUrl: options?.baseUrl,
    region: options?.region,
    apiVersion: options?.apiVersion,
    secretKey: options?.secretKey,
  });
}

export function createValidateCommand(): Command {
  const cmd = new Command('validate');
  cmd.description('Run pre-flight checks on config, connectivity, and evaluator keys');

  cmd.argument('[config]', 'Path to eval config file (e.g. my-service.dt-eval.yaml)');
  cmd.option('--config <path>', 'Path to eval config file (alias for positional argument)');

  cmd.action(async (configArg: string | undefined, options: { config?: string }) => {
    console.log('Running pre-flight checks...\n');

    const configPath = configArg ?? options.config;
    let config;
    let configValid = false;

    // 1. Schema validation
    try {
      config = loadConfig(configPath ? { projectFile: configPath } : undefined);
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

    // 2. DT connection — test origin (read) and destination (write) separately
    const { origin, destination } = resolveEndpoints(config.dynatrace);
    const sides: Array<['origin' | 'destination', { environmentUrl: string; apiToken?: string }]> = [
      ['origin', origin],
      ['destination', destination],
    ];
    for (const [label, side] of sides) {
      if (!side.apiToken) {
        logger.error(`${label} API token not set  (${side.environmentUrl || 'no url'})`);
        continue;
      }
      const dtOk = await testDynatraceConnection(side.environmentUrl, side.apiToken);
      if (dtOk) {
        logger.success(`${label} connection  (${side.environmentUrl})`);
      } else {
        logger.error(`${label} connection failed  (${side.environmentUrl})`);
        continue;
      }

      // Origin must be able to read the spans bucket — Grail returns
      // SUCCEEDED-with-empty-records on missing scope, so probe explicitly.
      if (label === 'origin') {
        const probe = await probeOriginSpansRead(side.environmentUrl, side.apiToken);
        if (probe.ok) {
          logger.success(`origin can read spans bucket`);
        } else {
          logger.error(`origin cannot read spans bucket: ${probe.reason}`);
          logger.error(`  → token needs storage:spans:read (and storage:buckets:read)`);
        }
      }
    }

    // 3. AI provider — real inference probe so a wrong model id or region
    //    surfaces as the actual upstream error, not "API reachable".
    const { ok: aiOk, model: aiModel, error: aiError } = await testAiProvider(
      config.judge.provider,
      config.judge.apiKey,
      config.judge.model,
      {
        baseUrl: config.judge.baseUrl,
        region: config.judge.region,
        apiVersion: config.judge.apiVersion,
        secretKey: config.judge.secretKey,
      },
    );
    if (aiOk) {
      logger.success(`Evaluator provider reachable  (${config.judge.provider}, model: ${aiModel})`);
    } else {
      logger.error(`Evaluator provider check failed  (${config.judge.provider}, model: ${aiModel})`);
      if (aiError) logger.error(`  ${aiError}`);
    }

    // 4. Evaluators
    try {
      const prompts = await listPrompts();
      const builtIn = prompts.filter(p => !((p as unknown as Record<string, unknown>)['custom']));
      const custom = prompts.filter(p => (p as unknown as Record<string, unknown>)['custom']);
      logger.success(`${builtIn.length} built-in evaluators available`);
      logger.success(`${custom.length} custom evaluators loaded`);
    } catch (err) {
      logger.error(`Failed to load evaluators: ${(err as Error).message}`);
    }

    if (configValid) {
      console.log('\nAll checks passed. Ready to run evaluations.');
    } else {
      console.log('\nSome checks failed. Run "dt-evals configure" to fix issues.');
      process.exit(1);
    }
  });

  return cmd;
}
