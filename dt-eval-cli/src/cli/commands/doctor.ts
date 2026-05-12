import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { Spinner } from '../../ui/spinner.js';
import { loadConfig, validateConfig } from '../../config/index.js';
import { DEFAULT_JUDGE_MODELS } from '../../config/defaults.js';
import * as dtctl from '../../dtctl/index.js';
import { printDoctorBanner } from '../../ui/banner.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Issue {
  severity: 'error' | 'warning';
  section: string;
  message: string;
  action?: string;
}

interface RunLogEntry {
  runId: string;
  timestamp: string;
  spansEvaluated: number;
  resultsWritten: number;
  errors: number;
  durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ok = (msg: string) => console.log(`  ${pc.green('✓')} ${msg}`);
const fail = (msg: string) => console.log(`  ${pc.red('✗')} ${msg}`);
const warn = (msg: string) => console.log(`  ${pc.yellow('⚠')} ${msg}`);
const info = (msg: string) => console.log(`  ${pc.dim('→')} ${msg}`);
const sectionHeader = (n: number, total: number, title: string) =>
  console.log(`\n${pc.bold(`[${n}/${total}]`)} ${pc.bold(title)}`);

function updateEnvFile(filePath: string, updates: Record<string, string>): void {
  let lines: string[] = existsSync(filePath)
    ? readFileSync(filePath, 'utf-8').split('\n')
    : [];

  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex(l => l.startsWith(`${key}=`) || l.startsWith(`${key} =`));
    const newLine = `${key}=${value}`;
    if (idx !== -1) {
      lines[idx] = newLine;
    } else {
      lines.push(newLine);
    }
  }

  // Remove trailing empty lines then add one
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

function getNodeMajor(): number {
  return parseInt(process.version.replace('v', '').split('.')[0] ?? '0', 10);
}

async function getPackageVersion(pkgName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('npm', ['list', pkgName, '--depth=0', '--json'], {
      timeout: 10_000,
      cwd: process.cwd(),
    });
    const data = JSON.parse(stdout) as { dependencies?: Record<string, { version?: string }> };
    return data.dependencies?.[pkgName]?.version ?? null;
  } catch {
    return null;
  }
}

async function testAiProvider(
  provider: string,
  apiKey?: string,
  model?: string,
  opts?: { baseUrl?: string; region?: string },
): Promise<{ ok: boolean; model: string; error?: string }> {
  const resolvedModel = model ?? DEFAULT_JUDGE_MODELS[provider] ?? 'unknown';
  try {
    if (provider === 'openai') {
      const key = apiKey ?? process.env['OPENAI_API_KEY'];
      if (!key) return { ok: false, model: resolvedModel, error: 'No API key configured' };
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      return { ok: r.ok, model: resolvedModel };
    }
    if (provider === 'anthropic') {
      const key = apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (!key) return { ok: false, model: resolvedModel, error: 'No API key configured' };
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000),
      });
      return { ok: r.ok, model: resolvedModel };
    }
    if (provider === 'azure-openai') {
      const key = apiKey ?? process.env['AZURE_OPENAI_API_KEY'];
      const endpoint = opts?.baseUrl ?? process.env['AZURE_OPENAI_ENDPOINT'];
      if (!key || !endpoint) return { ok: false, model: resolvedModel, error: 'API key or endpoint not configured' };
      const url = `${endpoint.replace(/\/$/, '')}/openai/models?api-version=2024-02-01`;
      const r = await fetch(url, { headers: { 'api-key': key }, signal: AbortSignal.timeout(8000) });
      return { ok: r.ok, model: resolvedModel };
    }
    if (provider === 'gemini') {
      const key = apiKey ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'];
      if (!key) return { ok: false, model: resolvedModel, error: 'No API key configured' };
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
        { signal: AbortSignal.timeout(8000) },
      );
      return { ok: r.ok, model: resolvedModel };
    }
    if (provider === 'bedrock') {
      const hasCredentials =
        !!(process.env['AWS_ACCESS_KEY_ID'] && process.env['AWS_SECRET_ACCESS_KEY']) ||
        !!process.env['AWS_ROLE_ARN'] ||
        !!(opts?.region ?? process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION']);
      return { ok: hasCredentials, model: resolvedModel, error: hasCredentials ? undefined : 'AWS credentials not found in environment' };
    }
    return { ok: false, model: resolvedModel, error: `Unknown provider: ${provider}` };
  } catch (err) {
    return { ok: false, model: resolvedModel, error: (err as Error).message };
  }
}

function analyzeRunHistory(runsPath: string): {
  total: number;
  lastRun: RunLogEntry | null;
  recentFailed: number;
  avgDurationMs: number;
  recentErrorSamples: string[];
} {
  if (!existsSync(runsPath)) {
    return { total: 0, lastRun: null, recentFailed: 0, avgDurationMs: 0, recentErrorSamples: [] };
  }
  try {
    const runs = JSON.parse(readFileSync(runsPath, 'utf-8')) as RunLogEntry[];
    if (!Array.isArray(runs) || runs.length === 0) {
      return { total: 0, lastRun: null, recentFailed: 0, avgDurationMs: 0, recentErrorSamples: [] };
    }
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = runs.filter(r => new Date(r.timestamp).getTime() > sevenDaysAgo);
    const recentFailed = recent.filter(r => r.errors > 0 || r.resultsWritten === 0).length;
    const avgDurationMs = recent.length > 0
      ? Math.round(recent.reduce((s, r) => s + r.durationMs, 0) / recent.length)
      : 0;
    const lastRun = runs[runs.length - 1] ?? null;
    return { total: runs.length, lastRun, recentFailed, avgDurationMs, recentErrorSamples: [] };
  } catch {
    return { total: 0, lastRun: null, recentFailed: 0, avgDurationMs: 0, recentErrorSamples: [] };
  }
}

function humanTimeSince(isoTs: string): string {
  const ms = Date.now() - new Date(isoTs).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export function createDoctorCommand(): Command {
  const cmd = new Command('doctor');
  cmd.description('Diagnose your environment: authenticate via dtctl, verify permissions, generate a platform token, and check AI provider connectivity');

  cmd.option('--context <name>', 'Use an existing dtctl context name (skip interactive selection)');
  cmd.option('--env-url <url>', 'Dynatrace environment URL (overrides config)');
  cmd.option('--skip-token', 'Skip platform token generation (use if you already have DT_API_TOKEN)');
  cmd.option('--skip-auth', 'Skip dtctl authentication (only run config/provider/history checks)');

  cmd.action(async (rawOptions: {
    context?: string;
    envUrl?: string;
    skipToken?: boolean;
    skipAuth?: boolean;
  }) => {
    let options = rawOptions;
    const TOTAL_SECTIONS = 6;
    const issues: Issue[] = [];

    printDoctorBanner();
    console.log(pc.bold('═'.repeat(60)));

    // ── Load existing config if available ─────────────────────────
    let existingConfig: ReturnType<typeof loadConfig> | null = null;
    try {
      existingConfig = loadConfig();
    } catch {
      // no config yet, that's fine
    }

    let inquirer: typeof import('@inquirer/prompts') | null = null;
    try {
      inquirer = await import('@inquirer/prompts');
    } catch {
      // non-interactive fallback
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 1: Dependencies
    // ══════════════════════════════════════════════════════════════
    sectionHeader(1, TOTAL_SECTIONS, 'Dependencies');

    const nodeMajor = getNodeMajor();
    if (nodeMajor >= 18) {
      ok(`Node.js ${process.version}`);
    } else {
      fail(`Node.js ${process.version} — requires v18 or later`);
      issues.push({
        severity: 'error',
        section: 'Dependencies',
        message: `Node.js ${process.version} is below the minimum required version (v18)`,
        action: 'Upgrade Node.js to v18+ from https://nodejs.org',
      });
    }

    // Check dt-eval-lib version
    const libVersion = await getPackageVersion('dt-eval-lib');
    if (libVersion) {
      ok(`dt-eval-lib v${libVersion}`);
    } else {
      warn('dt-eval-lib version unknown (run from a project directory for full check)');
    }

    // Check dtctl
    let dtctlInstalled = false;
    let dtctlVersion: string | null = null;
    if (!options.skipAuth) {
      dtctlVersion = await dtctl.getDtctlVersion();
      dtctlInstalled = dtctlVersion !== null;
      if (dtctlInstalled) {
        ok(`dtctl found  (${dtctlVersion})`);
      } else {
        warn('dtctl not found — authentication and token generation sections will be skipped');
        info('Install dtctl: https://docs.dynatrace.com/docs/deliver/dynatrace-cli');
        issues.push({
          severity: 'warning',
          section: 'Dependencies',
          message: 'dtctl is not installed',
          action: 'Install dtctl from https://docs.dynatrace.com/docs/deliver/dynatrace-cli to enable OAuth authentication and token generation',
        });
      }
    } else {
      info('dtctl check skipped (--skip-auth)');
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 2: Dynatrace Authentication via dtctl
    // ══════════════════════════════════════════════════════════════
    sectionHeader(2, TOTAL_SECTIONS, 'Dynatrace Authentication');

    let bearerToken: string | null = null;
    let resolvedContextName: string | null = options.context ?? null;

    if (options.skipAuth || !dtctlInstalled) {
      info('Skipping dtctl authentication');
      if (!options.skipAuth) {
        info('Install dtctl to enable OAuth-based authentication and token generation');
      }
    } else {
      // List available contexts
      const spinner = new Spinner('Fetching dtctl contexts...');
      spinner.start();
      const contexts = await dtctl.listContexts();
      spinner.stop();

      if (contexts.length > 0) {
        console.log(`  Found ${contexts.length} context${contexts.length !== 1 ? 's' : ''}:`);
        contexts.forEach((c, i) => {
          const label = c.environmentUrl ? `${c.name}  (${c.environmentUrl})` : c.name;
          const marker = c.isDefault ? pc.dim(' [default]') : '';
          console.log(`    ${i + 1}. ${label}${marker}`);
        });
      }

      // ── Context selection ─────────────────────────────────────
      let contextEnvUrl: string | undefined;

      if (!resolvedContextName && inquirer) {
        const { select, input } = inquirer;
        const choices = [
          ...contexts.map(c => ({
            name: c.environmentUrl ? `${c.name}  (${c.environmentUrl})` : c.name,
            value: c.name,
            short: c.name,
          })),
          { name: pc.dim('+ Create new context (opens browser)'), value: '__new__', short: 'new' },
        ];

        if (contexts.length > 0) {
          resolvedContextName = await select({
            message: 'Select a dtctl context',
            choices,
          });
        } else {
          resolvedContextName = '__new__';
        }

        if (resolvedContextName === '__new__') {
          resolvedContextName = await input({
            message: 'New context name',
            default: 'dt-evals',
            validate: v => v.trim().length > 0 ? true : 'Context name is required',
          });
          // Need env URL to create a new context
          contextEnvUrl = options.envUrl ?? existingConfig?.dynatrace.environmentUrl ?? process.env['DT_ENV_URL'];
          if (!contextEnvUrl) {
            contextEnvUrl = await input({
              message: 'Dynatrace environment URL  (e.g. https://abc12345.apps.dynatrace.com)',
              validate: v => /^https?:\/\/.+/.test(v.trim()) ? true : 'Enter a valid URL',
            });
          }
        }
      } else if (!resolvedContextName) {
        // Fall back to current dtctl context
        resolvedContextName = (await dtctl.getCurrentContext()) ?? contexts[0]?.name ?? 'dt-evals';
        info(`Using context: ${resolvedContextName}`);
      }

      // Resolve env URL from context list if not already set
      if (!contextEnvUrl) {
        contextEnvUrl = contexts.find(c => c.name === resolvedContextName)?.environmentUrl;
      }
      // Will be merged into resolvedEnvUrl in section 3

      // ── Token check / login ───────────────────────────────────
      const tokenSpinner = new Spinner(`Getting token for context "${resolvedContextName}"...`);
      tokenSpinner.start();
      try {
        bearerToken = await dtctl.getBearerToken(resolvedContextName!);
        tokenSpinner.succeed(`Authenticated via context "${resolvedContextName}"`);
        if (contextEnvUrl) ok(`Environment: ${contextEnvUrl}`);
      } catch {
        tokenSpinner.stop();

        // Need to authenticate — determine env URL first
        if (!contextEnvUrl) {
          if (inquirer) {
            contextEnvUrl = await inquirer.input({
              message: 'Dynatrace environment URL  (e.g. https://abc12345.apps.dynatrace.com)',
              default: options.envUrl ?? existingConfig?.dynatrace.environmentUrl ?? process.env['DT_ENV_URL'] ?? '',
              validate: v => /^https?:\/\/.+/.test(v.trim()) ? true : 'Enter a valid URL',
            });
          } else {
            contextEnvUrl = options.envUrl ?? existingConfig?.dynatrace.environmentUrl ?? process.env['DT_ENV_URL'] ?? '';
          }
        }

        console.log(`\n  ${pc.dim(`No active session for "${resolvedContextName}" — opening browser for OAuth...`)}\n`);
        const authSpinner = new Spinner('Waiting for browser authentication...');
        authSpinner.start();
        try {
          bearerToken = await dtctl.authenticateWithBrowser(
            resolvedContextName!,
            contextEnvUrl,
            (elapsed) => authSpinner.update(`Waiting for browser authentication... (${elapsed}s)`),
          );
          authSpinner.succeed('Browser authentication complete');
          ok(`Authenticated via context "${resolvedContextName}"`);
        } catch (err) {
          authSpinner.fail('Authentication failed');
          fail((err as Error).message);
          issues.push({
            severity: 'error',
            section: 'Authentication',
            message: `Failed to authenticate via dtctl: ${(err as Error).message}`,
            action: `Run manually: dtctl auth login --context ${resolvedContextName} --environment <your-env-url>`,
          });
        }
      }

      // Surface context env URL for section 3
      if (contextEnvUrl && !options.envUrl) {
        options = { ...options, envUrl: contextEnvUrl };
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 3: Dynatrace Environment & Permissions
    // ══════════════════════════════════════════════════════════════
    sectionHeader(3, TOTAL_SECTIONS, 'Dynatrace Environment & Permissions');

    let resolvedEnvUrl = options.envUrl
      ?? existingConfig?.dynatrace.environmentUrl
      ?? process.env['DT_ENV_URL']
      ?? '';

    if (!resolvedEnvUrl && bearerToken && inquirer) {
      resolvedEnvUrl = await inquirer.input({
        message: 'Dynatrace environment URL  (e.g. https://abc12345.live.dynatrace.com)',
        validate: v => /^https?:\/\/.+/.test(v.trim()) ? true : 'Enter a valid URL',
      });
    }

    const grantedScopes: string[] = [];

    if (!resolvedEnvUrl) {
      warn('Environment URL not set — skipping permission checks');
      info('Set DT_ENV_URL or run "dt-evals configure" to fix this');
      issues.push({
        severity: 'error',
        section: 'Permissions',
        message: 'Dynatrace environment URL is not configured',
        action: 'Run "dt-evals configure" or set DT_ENV_URL in your .env file',
      });
    } else if (!bearerToken) {
      info(`Environment: ${resolvedEnvUrl}`);
      info('Skipping permission checks (no bearer token — dtctl not authenticated)');
    } else {
      ok(`Environment: ${resolvedEnvUrl}`);

      const permSpinner = new Spinner('Checking Dynatrace permissions...');
      permSpinner.start();

      const [spansCheck, eventsReadCheck, bizeventCheck, metricsCheck] = await Promise.all([
        dtctl.checkSpansPermission(resolvedEnvUrl, bearerToken),
        dtctl.checkEventsReadPermission(resolvedEnvUrl, bearerToken),
        dtctl.checkBizeventPermission(resolvedEnvUrl, bearerToken),
        dtctl.checkMetricsPermission(resolvedEnvUrl, bearerToken),
      ]);

      permSpinner.stop();

      // Required scopes — missing any of these blocks eval runs
      const requiredChecks = [spansCheck, eventsReadCheck, bizeventCheck];
      // Optional scopes — missing these limits functionality but doesn't block runs
      const optionalChecks = [metricsCheck];

      for (const check of requiredChecks) {
        if (check.ok) {
          ok(check.label);
          grantedScopes.push(check.scope);
        } else {
          fail(`${check.label}${check.error ? ` — ${check.error}` : ''}`);
          issues.push({
            severity: 'error',
            section: 'Permissions',
            message: `Missing required Dynatrace permission: ${check.scope}`,
            action: `Grant the "${check.scope}" scope to your Dynatrace token or OAuth client via IAM settings`,
          });
        }
      }

      for (const check of optionalChecks) {
        if (check.ok) {
          ok(`${check.label} ${pc.dim('(optional)')}`);
          grantedScopes.push(check.scope);
        } else {
          warn(`${check.label} — not available ${pc.dim('(optional, enables metric writes)')}`);
          issues.push({
            severity: 'warning',
            section: 'Permissions',
            message: `Missing optional Dynatrace permission: ${check.scope}`,
            action: 'Metric ingestion will be unavailable. Request this scope from your Dynatrace admin if needed.',
          });
        }
      }

      // Count GenAI spans
      if (dqlCheck.ok) {
        const spanSpinner = new Spinner('Querying GenAI spans (last 24h)...');
        spanSpinner.start();
        const service = existingConfig?.scope?.service;
        const spanCount = await dtctl.countGenAiSpans(resolvedEnvUrl, bearerToken, service);
        spanSpinner.stop();

        if (spanCount === null) {
          warn('Could not count GenAI spans — DQL timed out or query failed');
        } else if (spanCount === 0) {
          warn(`No GenAI spans in last 24h${service ? ` for service "${service}"` : ''}`);
          issues.push({
            severity: 'warning',
            section: 'Permissions',
            message: 'No GenAI spans found in Dynatrace in the last 24 hours',
            action: service
              ? `Verify that service "${service}" is emitting OpenTelemetry GenAI spans (gen_ai.* attributes)`
              : 'Configure a service in dt-evals and verify it emits OpenTelemetry GenAI spans',
          });
        } else {
          ok(`GenAI spans available — ${spanCount.toLocaleString()} in last 24h${service ? ` (service: ${service})` : ''}`);
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 4: Platform Token Generation
    // ══════════════════════════════════════════════════════════════
    sectionHeader(4, TOTAL_SECTIONS, 'Platform Token');

    const envFilePath = join(process.cwd(), '.env');
    const existingToken = existingConfig?.dynatrace.apiToken ?? process.env['DT_API_TOKEN'];

    if (existingToken && options.skipToken) {
      ok(`DT_API_TOKEN already set (${existingToken.slice(0, 8)}...)  — skipping token generation`);
    } else if (!bearerToken || !resolvedEnvUrl) {
      info('Skipping token generation (no authenticated dtctl session)');
      if (!existingToken) {
        issues.push({
          severity: 'error',
          section: 'Platform Token',
          message: 'No Dynatrace API token configured',
          action: 'Run "dt-evals doctor" with dtctl installed, or manually set DT_API_TOKEN in your .env file',
        });
      }
    } else {
      const scopesToGrant = grantedScopes.length > 0
        ? grantedScopes
        : [
            // Origin reads (DQL fetch spans + Grail bucket prerequisite)
            'storage:spans:read',
            'storage:buckets:read',
            // Destination reads + writes (eval bizevents, drift metrics)
            'storage:events:read',
            'storage:events:write',
            'storage:metrics:write',
            // validate's destination connectivity probe
            'storage:logs:read',
          ];

      if (existingToken) {
        console.log(`  Existing token found (${existingToken.slice(0, 8)}...)`);
        let shouldRegenerate = false;
        if (inquirer) {
          shouldRegenerate = await inquirer.confirm({
            message: 'Generate a new platform token and update .env?',
            default: false,
          });
        }
        if (!shouldRegenerate) {
          ok('Keeping existing DT_API_TOKEN');
        }
      }

      const shouldGenerate = !existingToken || inquirer === null;

      if (shouldGenerate || (inquirer && !existingToken)) {
        const tokenName = `dt-evals-${new Date().toISOString().slice(0, 10)}`;
        const tokenSpinner = new Spinner(`Creating platform token "${tokenName}" with scopes: ${scopesToGrant.join(', ')}...`);
        tokenSpinner.start();

        try {
          const created = await dtctl.createPlatformToken(resolvedEnvUrl, bearerToken, tokenName, scopesToGrant);
          tokenSpinner.succeed(`Token created: ${created.token.slice(0, 12)}...`);

          const envUpdates: Record<string, string> = {
            DT_API_TOKEN: created.token,
            DT_ENV_URL: resolvedEnvUrl,
          };
          updateEnvFile(envFilePath, envUpdates);
          ok(`DT_API_TOKEN written to ${envFilePath}`);
          ok(`DT_ENV_URL written to ${envFilePath}`);
          info('Scopes granted: ' + scopesToGrant.join(', '));
        } catch (err) {
          tokenSpinner.fail('Token creation failed');
          fail((err as Error).message);
          issues.push({
            severity: 'error',
            section: 'Platform Token',
            message: `Failed to create platform token: ${(err as Error).message}`,
            action: 'Ensure your dtctl OAuth token has the "apiTokens:write" scope, or create the token manually in Dynatrace Settings → Access Tokens',
          });
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 5: AI Provider
    // ══════════════════════════════════════════════════════════════
    sectionHeader(5, TOTAL_SECTIONS, 'AI Provider (Evaluator)');

    let providerConfig = existingConfig?.judge;

    if (!providerConfig && inquirer) {
      const provider = await inquirer.select({
        message: 'Which AI provider do you use for evaluations?',
        choices: [
          { name: 'OpenAI', value: 'openai' as const },
          { name: 'Anthropic', value: 'anthropic' as const },
          { name: 'Azure OpenAI', value: 'azure-openai' as const },
          { name: 'Google Gemini', value: 'gemini' as const },
          { name: 'AWS Bedrock', value: 'bedrock' as const },
        ],
      });
      providerConfig = { provider };
    }

    if (!providerConfig) {
      info('No AI provider configured — run "dt-evals configure" to set one up');
    } else {
      const { ok: providerOk, model, error: providerError } = await testAiProvider(
        providerConfig.provider,
        providerConfig.apiKey,
        providerConfig.model,
        { baseUrl: providerConfig.baseUrl, region: providerConfig.region },
      );

      console.log(`  Provider: ${providerConfig.provider} / ${model}`);

      if (providerOk) {
        ok(`${providerConfig.provider} API reachable`);
        ok(`Model: ${model}`);
      } else {
        fail(`${providerConfig.provider} API unreachable or API key invalid`);
        if (providerError) info(providerError);

        const envVarHints: Record<string, string> = {
          openai: 'OPENAI_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
          'azure-openai': 'AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT',
          gemini: 'GEMINI_API_KEY',
          bedrock: 'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION',
        };

        issues.push({
          severity: 'error',
          section: 'AI Provider',
          message: `${providerConfig.provider} provider is not reachable${providerError ? `: ${providerError}` : ''}`,
          action: `Set ${envVarHints[providerConfig.provider] ?? 'the required API key'} in your .env file`,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════
    // SECTION 6: Configuration & Run History
    // ══════════════════════════════════════════════════════════════
    sectionHeader(6, TOTAL_SECTIONS, 'Configuration & Run History');

    // Config file checks
    const projectConfigPath = join(process.cwd(), '.dt-eval.yaml');
    const globalConfigPath = join(homedir(), '.dt-eval', 'config.yaml');
    const hasProjectConfig = existsSync(projectConfigPath);
    const hasGlobalConfig = existsSync(globalConfigPath);

    if (hasProjectConfig) {
      ok(`Project config: ${projectConfigPath}`);
    } else if (hasGlobalConfig) {
      ok(`Global config: ${globalConfigPath}`);
    } else {
      warn('No config file found');
      issues.push({
        severity: 'warning',
        section: 'Configuration',
        message: 'No .dt-eval.yaml found in current directory or ~/.dt-eval/config.yaml',
        action: 'Run "dt-evals configure" to create a configuration file',
      });
    }

    if (existingConfig) {
      try {
        validateConfig(existingConfig);
        ok(`Config schema valid  (name: ${existingConfig.name ?? '(unnamed)'})`);
      } catch (err) {
        fail(`Config schema invalid: ${(err as Error).message}`);
        issues.push({
          severity: 'error',
          section: 'Configuration',
          message: `Config validation failed: ${(err as Error).message}`,
          action: 'Run "dt-evals configure" to fix the configuration',
        });
      }

      // Check that a platform token is now set (post token generation)
      const tokenNowSet = existingConfig.dynatrace.apiToken ?? process.env['DT_API_TOKEN'];
      if (tokenNowSet) {
        ok(`DT_API_TOKEN is set`);
      } else if (!existsSync(envFilePath)) {
        warn('.env file not found — DT_API_TOKEN must be set as environment variable or in .env');
        issues.push({
          severity: 'warning',
          section: 'Configuration',
          message: 'No .env file found and DT_API_TOKEN is not set',
          action: 'Run "dt-evals doctor" to generate a platform token, or create .env with DT_API_TOKEN=<token>',
        });
      }
    }

    // Run history analysis
    const runsPath = join(homedir(), '.dt-eval', 'runs.json');
    const history = analyzeRunHistory(runsPath);

    if (history.total === 0) {
      info('No evaluation runs recorded yet');
    } else {
      const lastRun = history.lastRun!;
      const sinceLabel = humanTimeSince(lastRun.timestamp);
      const lastRunStatus = lastRun.errors === 0 && lastRun.resultsWritten > 0 ? pc.green('SUCCESS') : pc.red('FAILED');
      ok(`Last run: ${sinceLabel} — ${lastRunStatus} (${lastRun.spansEvaluated} spans, ${lastRun.resultsWritten} results)`);
      ok(`Total runs: ${history.total}  |  Avg duration: ${Math.round(history.avgDurationMs / 1000)}s`);

      if (history.recentFailed > 0) {
        warn(`${history.recentFailed} failed run${history.recentFailed !== 1 ? 's' : ''} in the last 7 days`);
        issues.push({
          severity: 'warning',
          section: 'Run History',
          message: `${history.recentFailed} failed run${history.recentFailed !== 1 ? 's' : ''} in the last 7 days`,
          action: 'Run "dt-evals runs list" to review failures and "dt-evals runs show <id>" for details',
        });
      }
    }

    // Check .env file exists
    if (existsSync(envFilePath)) {
      ok(`.env file found: ${envFilePath}`);
    } else {
      info('.env file not found (tokens can also be set via environment variables)');
    }

    // ══════════════════════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════════════════════
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    console.log('\n' + pc.bold('═'.repeat(60)));
    console.log(pc.bold('  Doctor Summary'));
    console.log(pc.bold('═'.repeat(60)));

    if (issues.length === 0) {
      console.log(`\n  ${pc.green('✓')} ${pc.bold('All checks passed!')} Your setup is ready.\n`);
      console.log(`  Next step: ${pc.cyan('dt-evals run')}\n`);
    } else {
      const summary = [
        errors.length > 0 ? pc.red(`${errors.length} error${errors.length !== 1 ? 's' : ''}`) : null,
        warnings.length > 0 ? pc.yellow(`${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`) : null,
      ].filter(Boolean).join(', ');
      console.log(`\n  ${summary} found\n`);

      if (errors.length > 0) {
        console.log(pc.red(pc.bold('  Errors (must fix):')));
        errors.forEach((issue, i) => {
          console.log(`\n  ${i + 1}. [${issue.section}] ${issue.message}`);
          if (issue.action) console.log(`     ${pc.dim('→')} ${issue.action}`);
        });
      }

      if (warnings.length > 0) {
        console.log('\n' + pc.yellow(pc.bold('  Warnings (recommended):')));
        warnings.forEach((issue, i) => {
          console.log(`\n  ${i + 1}. [${issue.section}] ${issue.message}`);
          if (issue.action) console.log(`     ${pc.dim('→')} ${issue.action}`);
        });
      }

      const hasTokenIssue = issues.some(i => i.section === 'Platform Token' && i.severity === 'error');

      if (errors.length === 0) {
        console.log(`\n  ${pc.green('✓')} Setup is mostly ready. Fix warnings for full functionality.`);
        console.log(`  Next step: ${pc.cyan('dt-evals run')}\n`);
      } else {
        if (hasTokenIssue) {
          console.log(`\n  To generate a platform token:  ${pc.cyan('dt-evals doctor create-token')}`);
        }
        console.log(`  Re-run full check:  ${pc.cyan('dt-evals doctor')}\n`);
      }
    }
  });

  cmd.addCommand(createDoctorCreateCommand());

  return cmd;
}

// ─── doctor create-token ──────────────────────────────────────────────────────

function createDoctorCreateCommand(): Command {
  const sub = new Command('create-token');
  sub.description('Generate a scoped Dynatrace platform token via dtctl and write it to .env');
  sub.option('--context <name>', 'dtctl context to use');
  sub.option('--env-url <url>', 'Dynatrace environment URL (overrides config)');

  sub.action(async (options: { context?: string; envUrl?: string }) => {
    printDoctorBanner();
    console.log(pc.bold('  Creating platform token via dtctl OAuth\n'));

    // ── Resolve existing config ────────────────────────────────
    let existingConfig: ReturnType<typeof loadConfig> | null = null;
    try { existingConfig = loadConfig(); } catch { /* none yet */ }

    let inquirer: typeof import('@inquirer/prompts') | null = null;
    try { inquirer = await import('@inquirer/prompts'); } catch { /* non-interactive */ }

    // ── Check dtctl ────────────────────────────────────────────
    const version = await dtctl.getDtctlVersion();
    if (!version) {
      fail('dtctl is not installed');
      info('Install dtctl: https://docs.dynatrace.com/docs/deliver/dynatrace-cli');
      process.exit(1);
    }
    ok(`dtctl found  (${version})`);

    // ── Context selection ──────────────────────────────────────
    const spinner = new Spinner('Fetching dtctl contexts...');
    spinner.start();
    const contexts = await dtctl.listContexts();
    spinner.stop();

    let resolvedContext = options.context ?? null;
    let contextEnvUrl: string | undefined;

    if (!resolvedContext && inquirer) {
      const choices = [
        ...contexts.map(c => ({
          name: c.environmentUrl ? `${c.name}  (${c.environmentUrl})` : c.name,
          value: c.name,
          short: c.name,
        })),
        { name: pc.dim('+ Create new context (opens browser)'), value: '__new__', short: 'new' },
      ];

      resolvedContext = contexts.length > 0
        ? await inquirer.select({ message: 'Select a dtctl context', choices })
        : '__new__';

      if (resolvedContext === '__new__') {
        resolvedContext = await inquirer.input({
          message: 'New context name',
          default: 'dt-evals',
          validate: v => v.trim().length > 0 ? true : 'Context name is required',
        });
      }
    } else if (!resolvedContext) {
      resolvedContext = (await dtctl.getCurrentContext()) ?? contexts[0]?.name ?? 'dt-evals';
    }

    contextEnvUrl = contexts.find(c => c.name === resolvedContext)?.environmentUrl;

    // ── Resolve env URL ────────────────────────────────────────
    let resolvedEnvUrl = options.envUrl
      ?? contextEnvUrl
      ?? existingConfig?.dynatrace.environmentUrl
      ?? process.env['DT_ENV_URL']
      ?? '';

    if (!resolvedEnvUrl && inquirer) {
      resolvedEnvUrl = await inquirer.input({
        message: 'Dynatrace environment URL  (e.g. https://abc12345.apps.dynatrace.com)',
        validate: v => /^https?:\/\/.+/.test(v.trim()) ? true : 'Enter a valid URL',
      });
    }

    // ── Authenticate ───────────────────────────────────────────
    const authSpinner = new Spinner(`Getting token for context "${resolvedContext}"...`);
    authSpinner.start();
    let bearerToken: string;
    try {
      bearerToken = await dtctl.getBearerToken(resolvedContext!);
      authSpinner.succeed(`Authenticated via "${resolvedContext}"`);
    } catch {
      authSpinner.stop();
      console.log(`\n  ${pc.dim(`No active session — opening browser for "${resolvedContext}"...`)}\n`);
      const loginSpinner = new Spinner('Waiting for browser authentication...');
      loginSpinner.start();
      try {
        bearerToken = await dtctl.authenticateWithBrowser(
          resolvedContext!,
          resolvedEnvUrl,
          (s) => loginSpinner.update(`Waiting for browser authentication... (${s}s)`),
        );
        loginSpinner.succeed('Authenticated');
      } catch (err) {
        loginSpinner.fail(`Authentication failed: ${(err as Error).message}`);
        info(`Run manually: dtctl auth login --context ${resolvedContext} --environment ${resolvedEnvUrl}`);
        process.exit(1);
      }
    }

    // ── Check permissions ──────────────────────────────────────
    console.log('');
    const permSpinner = new Spinner('Checking Dynatrace permissions...');
    permSpinner.start();
    const [spansCheck, eventsReadCheck, bizeventCheck, metricsCheck] = await Promise.all([
      dtctl.checkSpansPermission(resolvedEnvUrl, bearerToken),
      dtctl.checkEventsReadPermission(resolvedEnvUrl, bearerToken),
      dtctl.checkBizeventPermission(resolvedEnvUrl, bearerToken),
      dtctl.checkMetricsPermission(resolvedEnvUrl, bearerToken),
    ]);
    permSpinner.stop();

    const scopes: string[] = [];
    for (const check of [spansCheck, eventsReadCheck, bizeventCheck]) {
      if (check.ok) {
        ok(check.label);
        scopes.push(check.scope);
      } else {
        warn(`${check.label} — not available (required, token will be created without it)`);
      }
    }
    if (metricsCheck.ok) {
      ok(`${metricsCheck.label} ${pc.dim('(optional)')}`);
      scopes.push(metricsCheck.scope);
    } else {
      info(`${metricsCheck.label} — not available (optional, skipping)`);
    }

    // Foundational scopes that aren't probed individually but are required
    // by the runtime — included unconditionally so a doctor-minted token
    // can actually pass `dt-eval validate` and run end-to-end:
    //   - storage:buckets:read: Grail prerequisite for any storage table
    //     read; without it `fetch spans|logs|bizevents` returns
    //     SUCCEEDED-with-empty-records (silent failure).
    //   - storage:logs:read: validate's destination connectivity probe
    //     issues `fetch logs | limit 1`; without it the destination check
    //     fails even when writes work.
    if (!scopes.includes('storage:buckets:read')) scopes.push('storage:buckets:read');
    if (!scopes.includes('storage:logs:read')) scopes.push('storage:logs:read');

    if (scopes.length === 0) {
      fail('No permissions available — cannot create a usable token');
      info('Ensure your dtctl OAuth session has access to this Dynatrace environment');
      process.exit(1);
    }

    // ── Create token ───────────────────────────────────────────
    console.log('');
    const tokenName = `dt-evals-${new Date().toISOString().slice(0, 10)}`;
    const createSpinner = new Spinner(`Creating token "${tokenName}" with scopes: ${scopes.join(', ')}...`);
    createSpinner.start();

    try {
      const created = await dtctl.createPlatformToken(resolvedEnvUrl, bearerToken, tokenName, scopes);
      createSpinner.succeed(`Token created: ${created.token.slice(0, 12)}...`);

      const envFilePath = join(process.cwd(), '.env');
      updateEnvFile(envFilePath, { DT_API_TOKEN: created.token, DT_ENV_URL: resolvedEnvUrl });
      ok(`DT_API_TOKEN written to ${envFilePath}`);
      ok(`DT_ENV_URL written to ${envFilePath}`);

      console.log(`\n  ${pc.bold('Done.')} Run ${pc.cyan('dt-evals doctor')} to verify your full setup.\n`);
    } catch (err) {
      createSpinner.fail(`Token creation failed: ${(err as Error).message}`);
      info('Ensure your OAuth session has the "apiTokens:write" scope');
      info('Or create the token manually in Dynatrace Settings → Access Tokens');
      process.exit(1);
    }
  });

  return sub;
}
