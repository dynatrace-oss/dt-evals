/**
 * Builds the `.dt-eval.yaml` and child-process environment a CLI invocation
 * needs. Configuration goes in the YAML file, credentials go in the
 * environment; env vars beat the file, so a test can override one field
 * without rewriting the whole config.
 */

import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { envOr, envOrUndefined, reportMissingCredentials, tenant } from './env.js';
import { tenantCliEnv } from './cli.js';
import { FIXTURE_ATTRIBUTES, fixtureLookback, runService } from './fixtures.js';

export interface EvalConfig {
  schemaVersion: number;
  dynatrace: { environmentUrl?: string };
  judge: {
    provider: string;
    model?: string;
    region?: string;
    apiVersion?: string;
    baseUrl?: string;
    project?: string;
    location?: string;
  };
  scope: {
    service?: string;
    since: string;
    spanFields?: Record<string, string>;
    sampling?: { strategy: string; percent?: number; count?: number };
  };
  metrics: { enabled: unknown[] };
  alerts?: { thresholds: Record<string, number> };
}

/** Serialize a config to the file the CLI reads. JSON is valid YAML 1.2, so no YAML dependency is needed. */
export function toConfigFile(config: EvalConfig): string {
  return JSON.stringify(config, null, 2);
}

/** A judge provider the suite can reach, assembled from the environment. `undefined` if credentials are absent. */
export interface JudgeSetup {
  provider: string;
  model?: string;
  region?: string;
  apiVersion?: string;
  baseUrl?: string;
  project?: string;
  location?: string;
  /** Credentials to hand the child process. */
  env: Record<string, string>;
  /** Which of {@link env}'s keys are actual secrets, vs. config that merely travels alongside them. */
  secretEnvKeys: string[];
}

export function judgeFromEnv(): JudgeSetup | undefined {
  const provider = envOr('E2E_JUDGE_PROVIDER', 'bedrock');
  const model = envOrUndefined('E2E_JUDGE_MODEL');

  switch (provider) {
    case 'bedrock': {
      const keyId = envOrUndefined('AWS_ACCESS_KEY_ID');
      const secret = envOrUndefined('AWS_SECRET_ACCESS_KEY');
      const region = envOr('AWS_REGION', 'us-east-1');
      if (!keyId || !secret) {
        reportMissingCredentials('bedrock judge', ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
        return undefined;
      }
      return {
        provider,
        model,
        region,
        env: { AWS_ACCESS_KEY_ID: keyId, AWS_SECRET_ACCESS_KEY: secret, AWS_REGION: region },
        // AWS_REGION is configuration, not a credential.
        secretEnvKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
      };
    }
    case 'openai': {
      const key = envOrUndefined('OPENAI_API_KEY');
      if (!key) {
        reportMissingCredentials('openai judge', ['OPENAI_API_KEY']);
        return undefined;
      }
      return {
        provider,
        model,
        env: { OPENAI_API_KEY: key },
        secretEnvKeys: ['OPENAI_API_KEY'],
      };
    }
    case 'anthropic': {
      const key = envOrUndefined('ANTHROPIC_API_KEY');
      if (!key) {
        reportMissingCredentials('anthropic judge', ['ANTHROPIC_API_KEY']);
        return undefined;
      }
      return {
        provider,
        model,
        env: { ANTHROPIC_API_KEY: key },
        secretEnvKeys: ['ANTHROPIC_API_KEY'],
      };
    }
    case 'gemini': {
      // Both names exported: the library's `run`-path fallback only knows GOOGLE_API_KEY.
      const key = envOrUndefined('GEMINI_API_KEY') ?? envOrUndefined('GOOGLE_API_KEY');
      if (!key) {
        reportMissingCredentials('gemini judge', ['GEMINI_API_KEY or GOOGLE_API_KEY']);
        return undefined;
      }
      return {
        provider,
        model,
        env: { GEMINI_API_KEY: key, GOOGLE_API_KEY: key },
        secretEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      };
    }
    case 'vertex': {
      // Vertex authenticates via ADC, not an API key — must already be present.
      const project =
        envOrUndefined('GOOGLE_CLOUD_PROJECT') ??
        envOrUndefined('GCLOUD_PROJECT') ??
        envOrUndefined('GCP_PROJECT_ID');
      if (!project) {
        reportMissingCredentials('vertex judge', ['GOOGLE_CLOUD_PROJECT']);
        return undefined;
      }
      const location = envOr('GOOGLE_CLOUD_LOCATION', 'global');

      // The redirected child HOME breaks a relative/`~` path; fail here, naming it.
      const adc = envOrUndefined('GOOGLE_APPLICATION_CREDENTIALS');
      if (adc && (!isAbsolute(adc) || !existsSync(adc))) {
        throw new Error(
          `GOOGLE_APPLICATION_CREDENTIALS must be an absolute path to an existing file ` +
            `(the CLI runs with a throwaway HOME and cwd), got ${JSON.stringify(adc)}`,
        );
      }
      return {
        provider,
        model,
        project,
        location,
        env: {
          GOOGLE_CLOUD_PROJECT: project,
          GOOGLE_CLOUD_LOCATION: location,
          ...(adc ? { GOOGLE_APPLICATION_CREDENTIALS: adc } : {}),
        },
        // Empty on purpose: there is no key to invalidate here.
        secretEnvKeys: [],
      };
    }
    case 'azure-openai': {
      const key = envOrUndefined('AZURE_OPENAI_API_KEY');
      const baseUrl = envOrUndefined('AZURE_OPENAI_ENDPOINT');
      const apiVersion = envOrUndefined('AZURE_OPENAI_API_VERSION');
      // Azure has no default model: the deployment name is user-defined.
      if (!key || !baseUrl || !apiVersion || !model) {
        reportMissingCredentials('azure-openai judge', [
          'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_VERSION', 'E2E_JUDGE_MODEL',
        ]);
        return undefined;
      }
      return {
        provider,
        model,
        baseUrl,
        apiVersion,
        env: {
          AZURE_OPENAI_API_KEY: key,
          AZURE_OPENAI_ENDPOINT: baseUrl,
          AZURE_OPENAI_API_VERSION: apiVersion,
        },
        // Endpoint and API version are configuration; only the key is a secret.
        secretEnvKeys: ['AZURE_OPENAI_API_KEY'],
      };
    }
    default:
      reportMissingCredentials(
        `judge provider "${provider}" is not one of ` +
          `bedrock|openai|anthropic|azure-openai|gemini|vertex ` +
          `(the full set dt-eval-cli/src/config/schema.ts:24 accepts)`,
        ['E2E_JUDGE_PROVIDER'],
      );
      return undefined;
  }
}

/**
 * The config the suite treats as correct, with the `spanFields` mappings the
 * fixtures require. `overrides` is a *shallow* merge — passing `scope`
 * replaces the whole block and drops those mappings; spread the baseline's own
 * scope in to change just one field.
 */
export function baselineConfig(judge: JudgeSetup, overrides: Partial<EvalConfig> = {}): EvalConfig {
  const { appsEndpoint } = tenant();

  return {
    schemaVersion: 2,
    dynatrace: { environmentUrl: appsEndpoint },
    judge: {
      provider: judge.provider,
      ...(judge.model ? { model: judge.model } : {}),
      ...(judge.region ? { region: judge.region } : {}),
      ...(judge.apiVersion ? { apiVersion: judge.apiVersion } : {}),
      ...(judge.baseUrl ? { baseUrl: judge.baseUrl } : {}),
      ...(judge.project ? { project: judge.project } : {}),
      ...(judge.location ? { location: judge.location } : {}),
    },
    scope: {
      service: runService(),
      since: fixtureLookback(),
      spanFields: {
        systemInstruction: FIXTURE_ATTRIBUTES.systemInstruction,
        context: FIXTURE_ATTRIBUTES.context,
      },
      // No `count`: 'latest' takes every span found, so coverage tracks fixtures.json directly.
      sampling: { strategy: 'latest' },
    },
    metrics: { enabled: ['toxicity'] },
    ...overrides,
  };
}

/** Tenant + judge credentials for a CLI invocation. */
export function baselineEnv(judge: JudgeSetup): Record<string, string> {
  const { appsEndpoint, apiToken } = tenant();
  return { ...tenantCliEnv(appsEndpoint, apiToken), ...judge.env };
}
