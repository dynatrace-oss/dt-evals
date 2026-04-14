export const CURRENT_SCHEMA_VERSION = 1;

export interface DynatraceConfig {
  environmentUrl: string;
  apiToken?: string;
  /** dtctl context name to use for DQL queries via OAuth (avoids Api-Token DQL scope requirement) */
  dtctlContext?: string;
}

export interface JudgeConfig {
  provider: 'openai' | 'anthropic' | 'azure-openai' | 'gemini' | 'bedrock';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
  maxRetries?: number;
  /** AWS region for Bedrock; Azure OpenAI deployment endpoint base region */
  region?: string;
}

export interface ScopeConfig {
  service?: string; // service.name to filter spans (previously 'app')
  since: string; // e.g. "1h", "6h", "24h"
  sampling: {
    strategy: 'random' | 'latest' | 'errors-only';
    percent?: number; // for random
    count?: number;   // for latest
  };
}

export interface MetricsConfig {
  enabled: string[]; // metric ids from eval-lib catalog
}

export interface AlertsConfig {
  thresholds: Record<string, number>; // metric -> threshold score
  webhooks?: Array<{ url: string; type: 'slack' | 'generic' }>;
}

export interface DtEvalConfig {
  schemaVersion: number;
  /** Human-readable name for this eval configuration (e.g. "travel-advisor-prod") */
  name?: string;
  dynatrace: DynatraceConfig;
  judge: JudgeConfig;
  scope: ScopeConfig;
  metrics: MetricsConfig;
  alerts?: AlertsConfig;
}
