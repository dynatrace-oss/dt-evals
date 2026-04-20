export const CURRENT_SCHEMA_VERSION = 1;

export interface DynatraceConfig {
  environmentUrl: string;
  apiToken?: string;
  /** dtctl context name to use for DQL queries via OAuth (avoids Api-Token DQL scope requirement) */
  dtctlContext?: string;
}

export interface JudgeConfig {
  provider: 'openai' | 'anthropic' | 'azure-openai' | 'gemini' | 'bedrock';
  /** API key. For Bedrock: AWS access key ID. */
  apiKey?: string;
  /** For Bedrock: AWS secret access key. Falls back to AWS_SECRET_ACCESS_KEY env var. */
  secretKey?: string;
  /** For azure-openai: endpoint URL (e.g. https://my-resource.openai.azure.com/). Falls back to AZURE_OPENAI_ENDPOINT. */
  baseUrl?: string;
  /** For azure-openai: API version (e.g. 2025-04-01-preview). Falls back to AZURE_OPENAI_API_VERSION. Required for azure-openai. */
  apiVersion?: string;
  model?: string;
  timeout?: number;
  maxRetries?: number;
  /** For Bedrock: AWS region (e.g. us-east-1). Falls back to AWS_DEFAULT_REGION / AWS_REGION env vars. */
  region?: string;
}

export interface ScopeConfig {
  service?: string; // service.name to filter spans (previously 'app')
  since: string; // e.g. "1h", "6h", "24h"
  sampling?: {
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
