import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import pc from 'picocolors';
import { Spinner } from '../../ui/spinner.js';
import { loadConfig, validateConfig } from '../../config/index.js';
import { updateEnvFile } from '../../config/env-file.js';
import { probeProvider } from '../../probe/provider.js';
import * as dtctl from '../../dtctl/index.js';
import * as pasteToken from '../../dtctl/paste-token.js';
import { printDoctorBanner } from '../../ui/banner.js';

const execFileAsync = promisify(execFile);

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

// `testAiProvider` is now a thin shim around the shared `probeProvider` helper
// so doctor and validate report the same model+key+region failures the runtime
// will hit. The helper sends a real 1-token inference request, so wrong model
// ids (e.g. `sonnet` → 404 `model: sonnet`) and bad regions surface as the
// actual upstream error instead of "API reachable".
async function testAiProvider(
  provider: string,
  apiKey?: string,
  model?: string,
  opts?: { baseUrl?: string; region?: string; apiVersion?: string; secretKey?: string; project?: string; location?: string },
): Promise<{ ok: boolean; model: string; error?: string }> {
  return probeProvider({
    provider,
    apiKey,
    model,
    baseUrl: opts?.baseUrl,
    region: opts?.region,
    apiVersion: opts?.apiVersion,
    secretKey: opts?.secretKey,
    project: opts?.project,
    location: opts?.location,
  });
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
    // SECTION 2: Dynatrace Authentication via platform token
    // ══════════════════════════════════════════════════════════════
    //
    // History: this used to extract an OAuth bearer from `dtctl -vv auth
    // whoami` debug output. dtctl 0.24+ redacts the Authorization header
    // (#89), so that approach is dead and there's no public dtctl command
    // to print the access token. We replace it with a simple paste-back
    // flow: open the Dynatrace platform-tokens UI, let the user create a
    // scoped token themselves, paste it back here. Same end state, one
    // fewer moving part.
    sectionHeader(2, TOTAL_SECTIONS, 'Dynatrace Authentication');

    let bearerToken: string | null = null;
    const envFilePath = join(process.cwd(), '.env');
    const preExistingToken = existingConfig?.dynatrace.apiToken ?? process.env['DT_API_TOKEN'];

    if (options.skipAuth) {
      info('Skipping dtctl authentication');
    } else if (options.skipToken && preExistingToken) {
      ok('DT_API_TOKEN already set — using existing token');
      bearerToken = preExistingToken;
    } else if (preExistingToken && !options.skipToken && inquirer) {
      const reuse = await inquirer.confirm({
        message: 'DT_API_TOKEN already set. Reuse it?',
        default: true,
      });
      if (reuse) {
        ok('Reusing existing DT_API_TOKEN');
        bearerToken = preExistingToken;
      }
    }

    if (!bearerToken && !options.skipAuth) {
      // ── Resolve the environment URL we'll point the user at ──
      let envUrlForToken =
        options.envUrl
        ?? existingConfig?.dynatrace.environmentUrl
        ?? process.env['DT_ENV_URL']
        ?? '';
      if (!envUrlForToken && inquirer) {
        envUrlForToken = await inquirer.input({
          message: 'Dynatrace environment URL  (e.g. https://abc12345.apps.dynatrace.com)',
          validate: v => /^https?:\/\/.+/.test(v.trim()) ? true : 'Enter a valid URL',
        });
      }
      if (envUrlForToken && !options.envUrl) {
        options = { ...options, envUrl: envUrlForToken };
      }

      // ── Print scopes + URL, then wait for paste ──
      console.log(`\n  Generate a scoped platform token at ${pc.cyan(pasteToken.PLATFORM_TOKENS_URL)}`);
      console.log(`  ${pc.dim('Required scopes (select all of these on the token page):')}\n`);
      console.log(pasteToken.formatScopes(envUrlForToken));
      console.log('');

      if (inquirer) {
        const openNow = await inquirer.confirm({
          message: 'Open the platform-tokens page in your browser now?',
          default: true,
        });
        if (openNow) {
          await pasteToken.openBrowser(pasteToken.PLATFORM_TOKENS_URL);
          console.log(`  ${pc.dim('Opening browser…')}\n`);
        }
        const pasted = await inquirer.password({
          message: 'Paste your Dynatrace platform token (or press Enter to skip)',
          mask: '*',
          validate: v => {
            const t = v.trim();
            if (!t) return true; // empty = skip
            if (!pasteToken.looksLikePlatformToken(t)) {
              return 'That does not look like a Dynatrace platform token (expected dt0s16.…).';
            }
            return true;
          },
        });
        const trimmed = pasted.trim();
        if (trimmed) {
          bearerToken = trimmed;
          updateEnvFile(envFilePath, {
            DT_API_TOKEN: trimmed,
            ...(envUrlForToken ? { DT_ENV_URL: envUrlForToken } : {}),
          });
          ok(`Token saved to ${envFilePath}`);
          if (envUrlForToken) ok(`Environment: ${envUrlForToken}`);
        } else {
          warn('No token provided — permission probes and run history checks will be skipped');
          issues.push({
            severity: 'warning',
            section: 'Authentication',
            message: 'No Dynatrace API token configured',
            action: `Re-run "dt-evals doctor" and paste a token from ${pasteToken.PLATFORM_TOKENS_URL}`,
          });
        }
      } else {
        info(`Non-interactive mode — open ${pasteToken.PLATFORM_TOKENS_URL} and add DT_API_TOKEN to your .env manually`);
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
            message: `Missing optional Dynatrace permission: ${check.scope}. ${check.error}`,
            action: 'Metric ingestion will be unavailable. Request this scope from your Dynatrace admin if needed.',
          });
        }
      }

      // Count GenAI spans (only when the spans-read scope is granted)
      if (spansCheck.ok) {
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
    // SECTION 4: Platform Token Status
    // ══════════════════════════════════════════════════════════════
    //
    // Token acquisition now happens in Section 2 (user pastes a token they
    // created themselves at myaccount.dynatrace.com/platformTokens). This
    // section is a no-op confirmation so the 6-section structure stays
    // stable for users following along.
    sectionHeader(4, TOTAL_SECTIONS, 'Platform Token');

    if (bearerToken) {
      ok('Platform token configured');
      info(`Stored in ${envFilePath}`);
    } else {
      info('No platform token — Section 2 was skipped or no token was pasted.');
      info(`Generate one at ${pasteToken.PLATFORM_TOKENS_URL} and re-run "dt-evals doctor"`);
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
        {
          baseUrl: providerConfig.baseUrl,
          region: providerConfig.region,
          apiVersion: providerConfig.apiVersion,
          secretKey: providerConfig.secretKey,
          project: providerConfig.project,
          location: providerConfig.location,
        },
      );

      console.log(`  Provider: ${providerConfig.provider} / ${model}`);

      if (providerOk) {
        ok(`${providerConfig.provider} inference probe succeeded`);
        ok(`Model: ${model}`);
      } else {
        fail(`${providerConfig.provider} inference probe failed  (model: ${model})`);
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
  sub.description('Walk through creating a Dynatrace platform token and save it to .env');
  sub.option('--env-url <url>', 'Dynatrace environment URL (overrides config)');

  // dtctl 0.24+ redacts OAuth bearers, so we can't auto-mint a token anymore
  // (#89). Instead: surface the required scopes, open the Dynatrace token UI
  // for the user, and wait for them to paste a token back. Same end state,
  // no broken bearer extraction.
  sub.action(async (options: { envUrl?: string }) => {
    printDoctorBanner();
    console.log(pc.bold('  Set up a Dynatrace platform token for dt-evals\n'));

    // ── Resolve existing config ────────────────────────────────
    let existingConfig: ReturnType<typeof loadConfig> | null = null;
    try { existingConfig = loadConfig(); } catch { /* none yet */ }

    let inquirer: typeof import('@inquirer/prompts') | null = null;
    try { inquirer = await import('@inquirer/prompts'); } catch { /* non-interactive */ }

    // ── Resolve env URL ────────────────────────────────────────
    let resolvedEnvUrl =
      options.envUrl
      ?? existingConfig?.dynatrace.environmentUrl
      ?? process.env['DT_ENV_URL']
      ?? '';

    if (!resolvedEnvUrl && inquirer) {
      resolvedEnvUrl = await inquirer.input({
        message: 'Dynatrace environment URL  (e.g. https://abc12345.apps.dynatrace.com)',
        validate: v => /^https?:\/\/.+/.test(v.trim()) ? true : 'Enter a valid URL',
      });
    }

    // ── Show scopes + open browser ─────────────────────────────
    console.log(`  Open ${pc.cyan(pasteToken.PLATFORM_TOKENS_URL)} and create a new platform token.`);
    console.log(`  ${pc.dim('Select all the scopes below when the page prompts you:')}\n`);
    console.log(pasteToken.formatScopes(resolvedEnvUrl));
    console.log('');

    if (!inquirer) {
      info('Non-interactive mode — open the URL above and add DT_API_TOKEN to your .env manually');
      process.exit(0);
    }

    const openNow = await inquirer.confirm({
      message: 'Open the platform-tokens page in your browser now?',
      default: true,
    });
    if (openNow) {
      await pasteToken.openBrowser(pasteToken.PLATFORM_TOKENS_URL);
      console.log(`  ${pc.dim('Opening browser…')}\n`);
    }

    const pasted = await inquirer.password({
      message: 'Paste your Dynatrace platform token',
      mask: '*',
      validate: v => {
        const t = v.trim();
        if (!t) return 'Token is required';
        if (!pasteToken.looksLikePlatformToken(t)) {
          return 'That does not look like a Dynatrace platform token (expected dt0s16.…).';
        }
        return true;
      },
    });

    const token = pasted.trim();
    const envFilePath = join(process.cwd(), '.env');
    updateEnvFile(envFilePath, {
      DT_API_TOKEN: token,
      ...(resolvedEnvUrl ? { DT_ENV_URL: resolvedEnvUrl } : {}),
    });
    ok(`DT_API_TOKEN written to ${envFilePath}`);
    if (resolvedEnvUrl) ok(`DT_ENV_URL written to ${envFilePath}`);

    console.log(`\n  ${pc.bold('Done.')} Run ${pc.cyan('dt-evals doctor')} to verify your full setup.\n`);
  });

  return sub;
}
