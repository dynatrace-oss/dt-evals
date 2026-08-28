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
      expect(config.scope.sampling.percent).toBe(5);
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
      expect(config.sourcePath).toBe(GLOBAL_CONFIG_PATH);
    });

    it('sourcePath resolves to the project file when it exists, else the global, else undefined', () => {
      writeYaml(GLOBAL_CONFIG_PATH, { schemaVersion: 1, dynatrace: { environmentUrl: 'https://global.dynatrace.com' }, judge: { provider: 'openai' } });
      writeYaml(PROJECT_CONFIG_PATH, { dynatrace: { environmentUrl: 'https://project.dynatrace.com' } });

      expect(loadConfig({ globalFile: GLOBAL_CONFIG_PATH, projectFile: PROJECT_CONFIG_PATH }).sourcePath).toBe(PROJECT_CONFIG_PATH);
      expect(loadConfig({ globalFile: join(TEST_DIR, 'nope.yaml'), projectFile: join(TEST_DIR, 'nope.yaml') }).sourcePath).toBeUndefined();
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

    it('accepts a valid deterministic metric entry', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        { id: 'has-json', method: 'json_schema', params: { schema: { type: 'object' } } },
        { id: 'has-error', method: 'must_contain', params: { keywords: ['error'], mode: 'any' } },
        { id: 'no-refusal', method: 'must_not_contain', params: { keywords: ['i cannot help'], mode: 'any' } },
        { id: 'matches', method: 'regex', params: { pattern: '\\d+' } },
        { id: 'no-ssn', method: 'must_not_match', params: { pattern: '\\d{3}-\\d{2}-\\d{4}' } },
      ] as never;

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('rejects a ReDoS-vulnerable regex pattern at config time', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        { id: 'evil', method: 'must_not_match', params: { pattern: '^(a+)+$' } },
      ] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues.some(m => /ReDoS/.test(m))).toBe(true);
      }
    });

    it('accepts a safe (linear) regex pattern', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        { id: 'ok', method: 'must_not_match', params: { pattern: '\\d{3}-\\d{2}-\\d{4}' } },
      ] as never;

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('requires inputs.expectedOutput for exact_match', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [{ id: 'em', method: 'exact_match' }] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues.some(m => /exact_match.*inputs\.expectedOutput/.test(m))).toBe(true);
      }
    });

    it('accepts exact_match when inputs.expectedOutput routes a canonical field', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        { id: 'em', method: 'exact_match', inputs: { expectedOutput: 'context' } },
      ] as never;

      expect(() => validateConfig(config)).not.toThrow();
    });

    it.each(['input', 'output', 'context', 'expectedOutput'])(
      'rejects an invalid inputs.%s canonical field',
      (slot) => {
        const config = makeValidConfig();
        config.metrics.enabled = [
          {
            id: 'routed',
            method: 'must_contain',
            params: { keywords: ['ok'] },
            inputs: { [slot]: 'outpt' },
          },
        ] as never;

        expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
        try {
          validateConfig(config);
        } catch (err) {
          const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
          expect(issues).toContain(
            `metrics.enabled[0].inputs.${slot} must route one of: input, output, context, systemInstruction, model, userPrompt`,
          );
        }
      },
    );

    it('rejects unknown input routing slots', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        {
          id: 'routed',
          method: 'must_contain',
          params: { keywords: ['ok'] },
          inputs: { answer: 'output' },
        },
      ] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues).toContain('metrics.enabled[0].inputs.answer is not supported');
      }
    });

    it('rejects an invalid contains mode (typo silently coerced by the scorer otherwise)', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        { id: 'c', method: 'must_contain', params: { keywords: ['x'], mode: 'alll' } },
      ] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues.some(m => /mode must be "any" or "all"/.test(m))).toBe(true);
      }
    });

    it('rejects a non-string regex flags param', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        { id: 'r', method: 'regex', params: { pattern: 'abc', flags: 123 } },
      ] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
    });

    it('throws for an unknown method', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [{ id: 'x', method: 'bogus' }] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
    });

    it('throws when a deterministic method is missing required params', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        { id: 'r', method: 'regex' },
        { id: 'c', method: 'must_not_contain', params: { keywords: [] } },
      ] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues).toContain('metrics.enabled[0].params.pattern is required for method "regex"');
        expect(issues).toContain('metrics.enabled[1].params.keywords must be a non-empty string array for method "must_not_contain"');
      }
    });

    it('rejects a JSON Schema that AJV cannot compile', () => {
      const config = makeValidConfig();
      config.metrics.enabled = [
        {
          id: 'invalid-schema',
          method: 'json_schema',
          params: { schema: { type: 'not-a-json-schema-type' } },
        },
      ] as never;

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues.some(issue =>
          issue.startsWith('metrics.enabled[0].params.schema is not a valid JSON Schema:'),
        )).toBe(true);
      }
    });

    it('allows an empty scope.operationNames list to disable the operation-name filter', () => {
      const config = makeValidConfig({
        scope: {
          since: '1h',
          operationNames: [],
          sampling: { strategy: 'random', percent: 100 },
        },
      });

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('throws when scope.operationNames is not an array', () => {
      const config = makeValidConfig();
      (config.scope as unknown as { operationNames: unknown }).operationNames = 'chat';

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues).toContain('scope.operationNames must be an array of strings (use [] to disable the filter)');
      }
    });

    it('throws when scope.operationNames contains non-string or blank entries', () => {
      const config = makeValidConfig();
      (config.scope as unknown as { operationNames: unknown[] }).operationNames = ['chat', '', 42];

      expect(() => validateConfig(config)).toThrowError(ConfigValidationError);
      try {
        validateConfig(config);
      } catch (err) {
        const issues = (err as InstanceType<typeof ConfigValidationError>).issues;
        expect(issues).toContain('scope.operationNames[1] must be a non-empty string');
        expect(issues).toContain('scope.operationNames[2] must be a non-empty string');
      }
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
    it('writes valid YAML to disk without secrets', async () => {
      const { readFileSync } = await import('node:fs');
      const { parse } = await import('yaml');
      const config = makeValidConfig({
        dynatrace: {
          environmentUrl: 'https://test.live.dynatrace.com',
          apiToken: 'top-level-token',
          origin: { environmentUrl: 'https://read.live.dynatrace.com', apiToken: 'origin-token' },
          destination: { environmentUrl: 'https://write.live.dynatrace.com', apiToken: 'destination-token' },
        },
        judge: {
          provider: 'bedrock',
          apiKey: 'access-key-id',
          secretKey: 'secret-access-key',
          region: 'us-east-1',
          model: 'anthropic.claude-sonnet-4-5-20251001-v1:0',
          timeout: 30000,
          maxRetries: 2,
        },
      });
      const outPath = join(TEST_DIR, 'output.yaml');

      saveConfig(config, outPath);

      const content = readFileSync(outPath, 'utf-8');
      const parsed = parse(content);
      expect(parsed.dynatrace.environmentUrl).toBe(config.dynatrace.environmentUrl);
      expect(parsed.dynatrace.apiToken).toBeUndefined();
      expect(parsed.dynatrace.origin.apiToken).toBeUndefined();
      expect(parsed.dynatrace.destination.apiToken).toBeUndefined();
      expect(parsed.judge.provider).toBe(config.judge.provider);
      expect(parsed.judge.apiKey).toBeUndefined();
      expect(parsed.judge.secretKey).toBeUndefined();
    });

    it('roundtrip: save then load restores the same effective config when env vars provide secrets', () => {
      const config = makeValidConfig();
      const outPath = join(TEST_DIR, 'roundtrip.yaml');

      saveConfig(config, outPath);

      process.env['DT_API_TOKEN'] = config.dynatrace.apiToken;
      process.env['OPENAI_API_KEY'] = config.judge.apiKey;
      const loaded = loadConfig({ globalFile: join(TEST_DIR, 'nonexistent.yaml'), projectFile: outPath });
      expect(loaded.dynatrace.environmentUrl).toBe(config.dynatrace.environmentUrl);
      expect(loaded.dynatrace.apiToken).toBe(config.dynatrace.apiToken);
      expect(loaded.judge.provider).toBe(config.judge.provider);
      expect(loaded.judge.apiKey).toBe(config.judge.apiKey);
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
