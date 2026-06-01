import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  CURRENT_SCHEMA_VERSION,
  resolveEndpoints,
  type DtEvalConfig,
  type DynatraceConfig,
  type JudgeConfig,
  type ScopeConfig,
  type MetricsConfig,
} from './schema.js';
import { DEFAULT_CONFIG, DEFAULT_JUDGE_MODELS } from './defaults.js';
import { parseCondition, ConditionParseError } from '../alerts/condition.js';

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Config validation failed:\n${issues.map(i => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

export interface LoadConfigOptions {
  projectFile?: string;
  globalFile?: string;
}

function getGlobalConfigPath(): string {
  return join(homedir(), '.dt-eval', 'config.yaml');
}

function getProjectConfigPath(): string {
  return join(process.cwd(), '.dt-eval.yaml');
}

function readYamlFile(filePath: string): Partial<DtEvalConfig> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseYaml(content) as Partial<DtEvalConfig>;
  } catch (err) {
    throw new Error(`Failed to parse config file ${filePath}: ${(err as Error).message}`);
  }
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base } as T;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (
      overrideVal !== null &&
      overrideVal !== undefined &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      baseVal !== null &&
      baseVal !== undefined &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal as object, overrideVal as object) as T[keyof T];
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

/** Migrate legacy field names in-place before merging */
function migrateLegacy(config: Partial<DtEvalConfig>): Partial<DtEvalConfig> {
  const scope = config.scope as (DtEvalConfig['scope'] & { app?: string }) | undefined;
  if (scope?.app && !scope.service) {
    scope.service = scope.app;
    delete scope.app;
  }
  return config;
}

function applyEnvVars(config: DtEvalConfig): DtEvalConfig {
  const result = deepMerge(config, {});

  if (process.env['DT_ENV_URL']) {
    result.dynatrace.environmentUrl = process.env['DT_ENV_URL'];
  }
  if (process.env['DT_API_TOKEN']) {
    result.dynatrace.apiToken = process.env['DT_API_TOKEN'];
  }
  // Cross-tenant overrides
  if (process.env['DT_ORIGIN_ENV_URL'] || process.env['DT_ORIGIN_API_TOKEN']) {
    result.dynatrace.origin = {
      ...(result.dynatrace.origin ?? {}),
      ...(process.env['DT_ORIGIN_ENV_URL'] ? { environmentUrl: process.env['DT_ORIGIN_ENV_URL'] } : {}),
      ...(process.env['DT_ORIGIN_API_TOKEN'] ? { apiToken: process.env['DT_ORIGIN_API_TOKEN'] } : {}),
    };
  }
  if (process.env['DT_DESTINATION_ENV_URL'] || process.env['DT_DESTINATION_API_TOKEN']) {
    result.dynatrace.destination = {
      ...(result.dynatrace.destination ?? {}),
      ...(process.env['DT_DESTINATION_ENV_URL'] ? { environmentUrl: process.env['DT_DESTINATION_ENV_URL'] } : {}),
      ...(process.env['DT_DESTINATION_API_TOKEN'] ? { apiToken: process.env['DT_DESTINATION_API_TOKEN'] } : {}),
    };
  }
  if (process.env['JUDGE_PROVIDER']) {
    result.judge.provider = process.env['JUDGE_PROVIDER'] as JudgeConfig['provider'];
  }
  if (process.env['JUDGE_MODEL']) {
    result.judge.model = process.env['JUDGE_MODEL'];
  }

  const provider = result.judge.provider;
  if (provider === 'openai') {
    if (process.env['OPENAI_API_KEY']) result.judge.apiKey = process.env['OPENAI_API_KEY'];
    if (process.env['OPENAI_BASE_URL']) result.judge.baseUrl = process.env['OPENAI_BASE_URL'];
  } else if (provider === 'anthropic') {
    if (process.env['ANTHROPIC_API_KEY']) result.judge.apiKey = process.env['ANTHROPIC_API_KEY'];
    if (process.env['ANTHROPIC_BASE_URL']) result.judge.baseUrl = process.env['ANTHROPIC_BASE_URL'];
  } else if (provider === 'azure-openai') {
    if (process.env['AZURE_OPENAI_API_KEY']) result.judge.apiKey = process.env['AZURE_OPENAI_API_KEY'];
    if (process.env['AZURE_OPENAI_ENDPOINT']) result.judge.baseUrl = process.env['AZURE_OPENAI_ENDPOINT'];
    if (process.env['AZURE_OPENAI_API_VERSION']) result.judge.apiVersion = process.env['AZURE_OPENAI_API_VERSION'];
  } else if (provider === 'gemini') {
    if (process.env['GEMINI_API_KEY']) result.judge.apiKey = process.env['GEMINI_API_KEY'];
    else if (process.env['GOOGLE_API_KEY']) result.judge.apiKey = process.env['GOOGLE_API_KEY'];
  } else if (provider === 'bedrock') {
    if (process.env['AWS_REGION']) result.judge.region = process.env['AWS_REGION'];
  }

  return result;
}

export function resolveEffectiveConfig(partial: Partial<DtEvalConfig>): DtEvalConfig {
  const base: DtEvalConfig = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dynatrace: {
      environmentUrl: DEFAULT_CONFIG.dynatrace.environmentUrl ?? '',
    },
    judge: {
      provider: DEFAULT_CONFIG.judge.provider ?? 'openai',
      timeout: DEFAULT_CONFIG.judge.timeout,
      maxRetries: DEFAULT_CONFIG.judge.maxRetries,
      concurrency: DEFAULT_CONFIG.judge.concurrency,
    },
    scope: { ...DEFAULT_CONFIG.scope },
    metrics: { ...DEFAULT_CONFIG.metrics },
  };

  const merged = deepMerge(base, partial as DtEvalConfig);

  // Apply default model based on provider if not set
  if (!merged.judge.model) {
    merged.judge.model = DEFAULT_JUDGE_MODELS[merged.judge.provider];
  }

  return merged;
}

export function loadConfig(opts?: LoadConfigOptions): DtEvalConfig {
  const globalPath = opts?.globalFile ?? getGlobalConfigPath();
  const projectPath = opts?.projectFile ?? getProjectConfigPath();

  const globalConfig = readYamlFile(globalPath) ?? {};
  const projectConfig = readYamlFile(projectPath) ?? {};

  // Merge: defaults < global < project (migrate legacy field names first)
  const merged = resolveEffectiveConfig(deepMerge(migrateLegacy(globalConfig) as DtEvalConfig, migrateLegacy(projectConfig) as Partial<DtEvalConfig>));

  // Apply env var overrides (highest precedence)
  return applyEnvVars(merged);
}

export function saveConfig(config: DtEvalConfig, filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const yamlContent = stringifyYaml(config, { indent: 2 });
  writeFileSync(filePath, yamlContent, 'utf-8');
}

export function validateConfig(config: DtEvalConfig): void {
  const issues: string[] = [];

  // Validate concrete origin/destination after resolution. Either side may be
  // satisfied by top-level fields or by its own block.
  if (config.dynatrace) {
    const { origin, destination } = resolveEndpoints(config.dynatrace);
    const urlOk = (u?: string) => !!u && /^https?:\/\//.test(u);
    if (!urlOk(origin.environmentUrl)) {
      issues.push('dynatrace.origin.environmentUrl (or dynatrace.environmentUrl) is required and must be http(s)://');
    }
    if (!urlOk(destination.environmentUrl)) {
      issues.push('dynatrace.destination.environmentUrl (or dynatrace.environmentUrl) is required and must be http(s)://');
    }
  } else {
    issues.push('dynatrace config is required');
  }

  if (!config.judge?.provider) {
    issues.push('judge.provider is required');
  } else if (!['openai', 'anthropic', 'azure-openai', 'gemini', 'bedrock'].includes(config.judge.provider)) {
    issues.push(`judge.provider must be one of: openai, anthropic, azure-openai, gemini, bedrock (got "${config.judge.provider}")`);
  }

  if (config.judge?.concurrency) {
    const c = config.judge.concurrency;
    if (!Number.isInteger(c) || c < 1) {
      issues.push(`judge.concurrency must be a positive integer (got ${JSON.stringify(c)})`);
    }
  }

  if (!config.scope?.since) {
    issues.push('scope.since is required (e.g. "1h", "6h", "24h")');
  } else if (!/^\d+[smhd]$/.test(config.scope.since)) {
    issues.push('scope.since must be a duration like "1h", "30m", "24h"');
  }

  const { strategy } = config.scope?.sampling ?? {};
  if (strategy && !['random', 'latest', 'errors-only'].includes(strategy)) {
    issues.push(`scope.sampling.strategy must be one of: random, latest, errors-only`);
  }

  if (!config.metrics?.enabled?.length) {
    issues.push('metrics.enabled must have at least one metric');
  } else {
    for (const [i, entry] of config.metrics.enabled.entries()) {
      if (typeof entry === 'string') {
        if (!entry.trim()) issues.push(`metrics.enabled[${i}] must be a non-empty string`);
      } else if (entry && typeof entry === 'object') {
        if (typeof (entry as { id?: unknown }).id !== 'string' || !(entry as { id: string }).id.trim()) {
          issues.push(`metrics.enabled[${i}].id must be a non-empty string`);
        }
      } else {
        issues.push(`metrics.enabled[${i}] must be a string or { id, inputs? } object`);
      }
    }
  }

  if (config.alerts?.notifications) {
    for (const [i, n] of config.alerts.notifications.entries()) {
      const where = `alerts.notifications[${i}]`;
      if (!n.name?.trim()) issues.push(`${where}.name is required`);
      if (!n.metric?.trim()) issues.push(`${where}.metric is required`);
      if (!n.condition?.trim()) {
        issues.push(`${where}.condition is required (e.g. "avg > 2")`);
      } else {
        try { parseCondition(n.condition); }
        catch (err) {
          if (err instanceof ConditionParseError) issues.push(`${where}.condition: ${err.message}`);
          else throw err;
        }
      }
      if (!n.window?.trim()) issues.push(`${where}.window is required (e.g. "15m")`);
      else if (!/^\d+[smhd]$/.test(n.window)) issues.push(`${where}.window must be like "5m", "1h", "24h"`);
      if (!n.channel) {
        issues.push(`${where}.channel is required`);
      } else {
        const c = n.channel;
        if (!['slack', 'email', 'webhook'].includes(c.type)) {
          issues.push(`${where}.channel.type must be slack | email | webhook (got "${c.type}")`);
        }
        if (c.type === 'slack') {
          if (c.webhookUrl) {
            issues.push(
              `${where}.channel: type:slack uses the Dynatrace Slack action; remove webhookUrl and set connection: <name>. ` +
              `For an inline incoming-webhook URL, use type:webhook instead.`,
            );
          }
          if (!c.connection) {
            issues.push(`${where}.channel.connection is required for type:slack (the Dynatrace Slack connection name)`);
          }
        }
        if (c.type === 'email') {
          if (c.webhookUrl) {
            issues.push(`${where}.channel: email channels use the Dynatrace email action; remove webhookUrl`);
          }
          if (!c.to || c.to.length === 0) {
            issues.push(`${where}.channel.to is required for email`);
          }
          // No connection requirement — the Dynatrace email action uses the
          // tenant's configured outbound mail (Settings → Notifications), not a
          // per-workflow connection.
        }
        if (c.type === 'webhook' && !c.webhookUrl) {
          issues.push(`${where}.channel.webhookUrl is required for type:webhook`);
        }
      }
    }
    const names = config.alerts.notifications.map(n => n.name).filter(Boolean);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      issues.push(`alerts.notifications: duplicate name(s): ${[...new Set(dupes)].join(', ')}`);
    }
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }
}
