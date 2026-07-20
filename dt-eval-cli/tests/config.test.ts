import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import type { DtEvalConfig } from '../src/config/schema.js';

// We need to test config in isolation, so we import after mocking fs paths
let loadConfig: typeof import('../src/config/index.js').loadConfig;
let saveConfig: typeof import('../src/config/index.js').saveConfig;
let validateConfig: typeof import('../src/config/index.js').validateConfig;
let resolveEffectiveConfig: typeof import('../src/config/index.js').resolveEffectiveConfig;
let ConfigValidationError: typeof import('../src/config/index.js').ConfigValidationError;

const TEST_DIR = join(tmpdir(), `dt-eval-test-${Date.now()}`);
const GLOBAL_CONFIG_PATH = join(TEST_DIR, 'global-config.yaml');
const PROJECT_CONFIG_PATH = join(TEST_DIR, 'project-config.yaml');

function makeValidConfig(overrides?: Partial<DtEvalConfig>): DtEvalConfig {
  return {
    schemaVersion: 1,
    dynatrace: {
      environmentUrl: 'https://test.live.dynatrace.com',
      apiToken: 'test-token',
    },
    judge: {
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o',
      timeout: 30000,
      maxRetries: 2,
    },
    scope: {
      since: '1h',
      sampling: { strategy: 'random', percent: 100 },
    },
    metrics: {
      enabled: ['toxicity', 'relevance'],
    },
    ...overrides,
  };
}

function writeYaml(filePath: string, data: unknown): void {
  writeFileSync(filePath, stringifyYaml(data, { indent: 2 }), 'utf-8');
}

const ENV_KEYS = [
  'DT_ENV_URL',
  'DT_API_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'JUDGE_PROVIDER',
  'JUDGE_MODEL',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'GCP_PROJECT_ID',
  'GOOGLE_CLOUD_LOCATION',
] as const;
let savedEnv: Partial<Record<string, string>> = {};

describe('config', () => {
  beforeEach(async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Save and clear all relevant env vars so real environment doesn't bleed into tests
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Dynamic import to avoid module caching issues with env vars
    const mod = await import('../src/config/index.js');
    loadConfig = mod.loadConfig;
    saveConfig = mod.saveConfig;
    validateConfig = mod.validateConfig;
    resolveEffectiveConfig = mod.resolveEffectiveConfig;
    ConfigValidationError = mod.ConfigValidationError;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    // Restore original env vars
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe('loadConfig', () => {
    it('merges global and project file correctly with project taking precedence', () => {
      const globalData = {
        schemaVersion: 1,
        dynatrace: { environmentUrl: 'https://global.dynatrace.com', apiToken: 'global-token' },
        judge: { provider: 'openai', model: 'gpt-4o' },
        scope: { since: '6h', sampling: { strategy: 'random', percent: 50 } },
        metrics: { enabled: ['toxicity'] },
      };
      const projectData = {
        dynatrace: { environmentUrl: 'https://project.dynatrace.com' },
        scope: { since: '1h', sampling: { strategy: 'random', percent: 100 } },
        metrics: { enabled: ['relevance', 'faithfulness'] },
      };

      writeYaml(GLOBAL_CONFIG_PATH, globalData);
      writeYaml(PROJECT_CONFIG_PATH, projectData);

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });

      expect(config.dynatrace.environmentUrl).toBe('https://project.dynatrace.com');
      expect(config.dynatrace.apiToken).toBe('global-token'); // inherited from global
      expect(config.scope.since).toBe('1h');
      expect(config.metrics.enabled).toEqual(['relevance', 'faithfulness']);
    });

    it('applies default values when fields are missing', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'openai' },
      });

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });

      expect(config.scope.since).toBe('1h');
      expect(config.scope.sampling.strategy).toBe('random');
      expect(config.scope.sampling.percent).toBe(100);
      expect(config.metrics.enabled).toEqual(['toxicity', 'relevance', 'faithfulness']);
      expect(config.judge.timeout).toBe(30000);
      expect(config.judge.maxRetries).toBe(2);
    });

    it('returns valid config from only global file when no project file exists', () => {
      writeYaml(GLOBAL_CONFIG_PATH, {
        schemaVersion: 1,
        dynatrace: { environmentUrl: 'https://global.dynatrace.com' },
        judge: { provider: 'openai' },
      });

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: join(TEST_DIR, 'nonexistent.yaml') });
      expect(config.dynatrace.environmentUrl).toBe('https://global.dynatrace.com');
    });
  });

  describe('env var overrides', () => {
    it('DT_ENV_URL overrides dynatrace.environmentUrl', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://from-file.dynatrace.com' },
        judge: { provider: 'openai' },
      });
      process.env['DT_ENV_URL'] = 'https://from-env.dynatrace.com';

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
      expect(config.dynatrace.environmentUrl).toBe('https://from-env.dynatrace.com');
    });

    it('DT_API_TOKEN overrides dynatrace.apiToken', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com', apiToken: 'file-token' },
        judge: { provider: 'openai' },
      });
      process.env['DT_API_TOKEN'] = 'env-token';

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
      expect(config.dynatrace.apiToken).toBe('env-token');
    });

    it('OPENAI_API_KEY sets judge.apiKey when provider is openai', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'openai' },
      });
      process.env['OPENAI_API_KEY'] = 'openai-key-from-env';

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
      expect(config.judge.apiKey).toBe('openai-key-from-env');
    });

    it('ANTHROPIC_API_KEY sets judge.apiKey when provider is anthropic', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'anthropic' },
      });
      process.env['ANTHROPIC_API_KEY'] = 'anthropic-key-from-env';

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
      expect(config.judge.apiKey).toBe('anthropic-key-from-env');
    });

    it('JUDGE_PROVIDER overrides judge.provider', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'openai' },
      });
      process.env['JUDGE_PROVIDER'] = 'anthropic';

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
      expect(config.judge.provider).toBe('anthropic');
    });

    it('JUDGE_MODEL overrides judge.model', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'openai', model: 'gpt-4o' },
      });
      process.env['JUDGE_MODEL'] = 'gpt-4o-mini';

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
      expect(config.judge.model).toBe('gpt-4o-mini');
    });

    it('GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION configure vertex defaults', () => {
      writeYaml(PROJECT_CONFIG_PATH, {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'vertex' },
      });
      process.env['GOOGLE_CLOUD_PROJECT'] = 'vertex-project';
      process.env['GOOGLE_CLOUD_LOCATION'] = 'global';

      const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
      expect(config.judge.project).toBe('vertex-project');
      expect(config.judge.location).toBe('global');
    });
  });

  describe('validateConfig', () => {
    it('passes for a valid config', () => {
      expect(() => validateConfig(makeValidConfig())).not.toThrow();
    });

    it('throws ConfigValidationError when no origin/destination URL can be resolved', () => {
      const config = makeValidConfig();
      config.dynatrace.environmentUrl = '';

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues.some(i => i.includes('origin.environmentUrl'))).toBe(true);
        expect(issues.some(i => i.includes('destination.environmentUrl'))).toBe(true);
      }
    });

    it('throws ConfigValidationError for missing judge.provider', () => {
      const config = makeValidConfig();
      // @ts-expect-error: intentionally invalid for test
      config.judge.provider = '';

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
    });

    it('throws for invalid environmentUrl format', () => {
      const config = makeValidConfig();
      config.dynatrace.environmentUrl = 'not-a-url';

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues.some(i => i.includes('http(s)://'))).toBe(true);
      }
    });

    it('throws for empty metrics.enabled', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [];

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
    });

    it('throws for invalid scope.since format', () => {
      const config = makeValidConfig();
      config.scope.since = 'invalid';

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
    });

    it('passes when only origin/destination are set (no top-level url)', async () => {
      const { resolveEndpoints } = await import('../src/config/schema.js');
      const config = makeValidConfig();
      config.dynatrace = {
        origin: { environmentUrl: 'https://read.live.dynatrace.com', apiToken: 'r' },
        destination: { environmentUrl: 'https://write.live.dynatrace.com', apiToken: 'w' },
      };

      expect(() => validateConfig(config)).not.toThrow();
      const { origin, destination } = resolveEndpoints(config.dynatrace);
      expect(origin.environmentUrl).toBe('https://read.live.dynatrace.com');
      expect(destination.environmentUrl).toBe('https://write.live.dynatrace.com');
    });
  });

  describe('resolveEndpoints', () => {
    it('uses top-level fields as fallback for both sides (single-tenant config)', async () => {
      const { resolveEndpoints } = await import('../src/config/schema.js');
      const { origin, destination } = resolveEndpoints({
        environmentUrl: 'https://shared.live.dynatrace.com',
        apiToken: 'shared-token',
      });
      expect(origin.environmentUrl).toBe('https://shared.live.dynatrace.com');
      expect(origin.apiToken).toBe('shared-token');
      expect(destination.environmentUrl).toBe('https://shared.live.dynatrace.com');
      expect(destination.apiToken).toBe('shared-token');
    });

    it('per-side overrides win over top-level fallback', async () => {
      const { resolveEndpoints } = await import('../src/config/schema.js');
      const { origin, destination } = resolveEndpoints({
        environmentUrl: 'https://shared.live.dynatrace.com',
        apiToken: 'shared-token',
        origin: { apiToken: 'read-token' },
        destination: { environmentUrl: 'https://write.live.dynatrace.com' },
      });
      expect(origin.environmentUrl).toBe('https://shared.live.dynatrace.com');
      expect(origin.apiToken).toBe('read-token');
      expect(destination.environmentUrl).toBe('https://write.live.dynatrace.com');
      expect(destination.apiToken).toBe('shared-token');
    });
  });

  describe('cross-tenant env vars', () => {
    it('DT_ORIGIN_API_TOKEN / DT_DESTINATION_API_TOKEN flow through to the resolved endpoints', async () => {
      const { resolveEndpoints } = await import('../src/config/schema.js');
      writeFileSync(
        PROJECT_CONFIG_PATH,
        stringifyYaml({
          dynatrace: {
            origin: { environmentUrl: 'https://read.live.dynatrace.com' },
            destination: { environmentUrl: 'https://write.live.dynatrace.com' },
          },
          judge: { provider: 'openai', apiKey: 'k', model: 'gpt-4o', timeout: 30000, maxRetries: 2 },
          scope: { since: '1h' },
          metrics: { enabled: ['toxicity'] },
        }),
        'utf-8',
      );
      vi.stubEnv('DT_ORIGIN_API_TOKEN', 'origin-tok');
      vi.stubEnv('DT_DESTINATION_API_TOKEN', 'dest-tok');
      try {
        const config = loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH });
        const { origin, destination } = resolveEndpoints(config.dynatrace);
        expect(origin.apiToken).toBe('origin-tok');
        expect(destination.apiToken).toBe('dest-tok');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('saveConfig', () => {
    it('writes valid YAML to disk', async () => {
      const { readFileSync } = await import('node:fs');
      const { parse } = await import('yaml');
      const config = makeValidConfig();
      const outPath = join(TEST_DIR, 'output.yaml');

      saveConfig(config, outPath);

      const content = readFileSync(outPath, 'utf-8');
      const parsed = parse(content);
      expect(parsed.dynatrace.environmentUrl).toBe(config.dynatrace.environmentUrl);
      expect(parsed.judge.provider).toBe(config.judge.provider);
    });

    it('roundtrip: save then load returns the same config', () => {
      const config = makeValidConfig();
      const outPath = join(TEST_DIR, 'roundtrip.yaml');

      saveConfig(config, outPath);

      const loaded = loadConfig({ globalFile: join(TEST_DIR, 'nonexistent.yaml'), projectFile: outPath });
      expect(loaded.dynatrace.environmentUrl).toBe(config.dynatrace.environmentUrl);
      expect(loaded.judge.provider).toBe(config.judge.provider);
      expect(loaded.metrics.enabled).toEqual(config.metrics.enabled);
      expect(loaded.scope.since).toBe(config.scope.since);
    });
  });

  describe('resolveEffectiveConfig', () => {
    it('fills in defaults for missing fields', () => {
      const partial = {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'openai' as const },
      };

      const resolved = resolveEffectiveConfig(partial);
      expect(resolved.scope.since).toBe('1h');
      expect(resolved.scope.sampling.strategy).toBe('random');
      expect(resolved.metrics.enabled).toEqual(['toxicity', 'relevance', 'faithfulness']);
    });

    it('does not override provided values with defaults', () => {
      const partial = {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'anthropic' as const, model: 'claude-3-opus' },
        scope: { since: '24h', sampling: { strategy: 'latest' as const, count: 50 } },
        metrics: { enabled: ['user-frustration'] },
      };

      const resolved = resolveEffectiveConfig(partial);
      expect(resolved.judge.provider).toBe('anthropic');
      expect(resolved.judge.model).toBe('claude-3-opus');
      expect(resolved.scope.since).toBe('24h');
      expect(resolved.metrics.enabled).toEqual(['user-frustration']);
    });

    it('uses gemini-3.1-flash-lite as the default model for vertex', () => {
      const partial = {
        dynatrace: { environmentUrl: 'https://test.dynatrace.com' },
        judge: { provider: 'vertex' as const },
      };

      const resolved = resolveEffectiveConfig(partial);
      expect(resolved.judge.model).toBe('gemini-3.1-flash-lite');
    });
  });
});
