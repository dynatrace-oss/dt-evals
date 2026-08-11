/**
 * Builds the `.dt-eval.yaml` and child-process environment a CLI invocation needs.
 *
 * Two rules the CLI itself establishes and this module follows:
 *   - configuration goes in the YAML file, credentials go in the environment.
 *     `saveConfig` strips secrets before writing
 *     (`dt-eval-cli/src/config/index.ts:186`), so putting a token in the YAML
 *     would be testing a shape the product deliberately never produces.
 *   - env vars beat the file (`applyEnvVars`, same file), which is what lets a
 *     test override one field without rewriting the whole config.
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

/**
 * Serialize a config to the file the CLI reads.
 *
 * Emitted as JSON on purpose: YAML 1.2 is a superset of JSON, and the CLI parses
 * the file with `yaml`, so a JSON document is valid input. This avoids either a
 * YAML dependency in the suite or a hand-rolled emitter whose quoting bugs would
 * look like CLI bugs. Not a shortcut — do not "fix" it into hand-written YAML.
 */
export function toConfigFile(config: EvalConfig): string {
  return JSON.stringify(config, null, 2);
}

/**
 * A judge provider the suite can actually reach, assembled from the environment.
 *
 * Returns `undefined` when the credentials for the selected provider are absent,
 * so a test can skip itself rather than fail on a missing key. Defaults to
 * Bedrock, which matches the credentials the instrumentation-examples suite
 * already provisions (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).
 */
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
  /**
   * Which of {@link env}'s keys are actually secrets, as opposed to
   * configuration that merely travels the same way.
   *
   * The negative test that invalidates judge credentials needs this: deriving
   * the set from `Object.keys(env)` also blanked `AWS_REGION` (and, on Azure,
   * the endpoint and API version), so the probe failed on endpoint resolution
   * before it ever presented a credential. The test passed while proving
   * nothing about credential rejection.
   */
  secretEnvKeys: string[];
}

export function judgeFromEnv(): JudgeSetup | undefined {
  const provider = envOr('E2E_JUDGE_PROVIDER', 'bedrock');
  const model = envOrUndefined('E2E_JUDGE_MODEL');

  switch (provider) {
    case 'bedrock': {
      // The Bedrock probe falls through to the AWS SDK's default credential
      // chain when judge.apiKey/secretKey are unset
      // (dt-eval-cli/src/probe/provider.ts:137), so the keys travel as env vars.
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
        // AWS_REGION is configuration, not a credential: blanking it makes the
        // SDK fail on endpoint resolution instead of on authentication.
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
      // The CLI accepts either name and copies whichever is set into
      // judge.apiKey (config/index.ts:123-125). The library's own fallback,
      // used on the `run` path, only knows GOOGLE_API_KEY
      // (dt-eval-lib/src/engine/providers/index.ts:18) — so both are exported to
      // keep `validate` and `run` on the same credential.
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
      // Vertex authenticates through Application Default Credentials, not an
      // API key: the CLI deliberately does not map GOOGLE_API_KEY for it
      // (config/index.ts:127-128). So the project is the only thing we can
      // require, and ADC has to be present in the environment already —
      // a service-account key file via GOOGLE_APPLICATION_CREDENTIALS, or
      // Workload Identity on the runner.
      const project =
        envOrUndefined('GOOGLE_CLOUD_PROJECT') ??
        envOrUndefined('GCLOUD_PROJECT') ??
        envOrUndefined('GCP_PROJECT_ID');
      if (!project) {
        reportMissingCredentials('vertex judge', ['GOOGLE_CLOUD_PROJECT']);
        return undefined;
      }
      const location = envOr('GOOGLE_CLOUD_LOCATION', 'global');

      // The child runs with a fresh cwd and a redirected HOME, so a relative or
      // `~`-prefixed path resolves somewhere meaningless and ADC fails with an
      // error that says nothing about the real cause. Fail here instead, naming
      // it. (The same HOME redirect also cuts off
      // ~/.config/gcloud/application_default_credentials.json, so `gcloud auth
      // application-default login` alone does not carry into the child — the
      // key file has to be explicit.)
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
        // Empty on purpose: there is no key to invalidate, so the
        // rejected-credentials test skips itself rather than blanking the
        // project and calling a config error an authentication failure.
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
 * The config the suite treats as correct: real tenant, real judge, scoped to the
 * fixture service, with the two `spanFields` mappings the fixtures require.
 *
 * The mappings are not incidental — the contract suite proves the fixtures emit
 * `gen_ai.system_instructions` (plural) and the non-semconv `gen_ai.context`,
 * neither of which the CLI reads by default.
 *
 * `overrides` is a *shallow* merge: passing `scope` replaces the whole block and
 * silently drops those `spanFields` mappings, which would show up as a judge
 * scoring against a missing system prompt rather than as an error. Override a
 * sibling key (`alerts`, `metrics`) freely; to change one `scope` field, spread
 * the baseline's own scope into the replacement.
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
      // No `count`: sampler.ts's 'latest' strategy takes `spans.length` when
      // count is omitted, i.e. every fixture span the service/lookback filter
      // finds. Coverage then tracks fixtures.json directly — add a case there
      // and the next seeding run makes it show up here too, with no dt-evals
      // change. A test that needs a *bounded* sample for its own reason
      // (cost, tenant content) sets its own `count` override; see run.e2e.test.ts.
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
