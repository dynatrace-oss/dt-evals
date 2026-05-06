export const CURRENT_SCHEMA_VERSION = 2;

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

/**
 * Override which span attributes feed each canonical GenAI field. Useful when
 * spans don't follow the OTel GenAI semantic convention (e.g. they expose
 * `llm.user_input` instead of `gen_ai.input.messages`).
 *
 * Each entry accepts a single attribute or a list of candidates; the first
 * non-null value wins. User candidates are tried *before* the built-in OTel
 * GenAI / OpenLLMetry defaults, so existing configs keep working.
 */
export interface SpanFieldsMap {
  input?: string | string[];
  output?: string | string[];
  systemInstruction?: string | string[];
  model?: string | string[];
}

export interface ScopeConfig {
  service?: string; // service.name to filter spans (previously 'app')
  since: string; // e.g. "1h", "6h", "24h"
  sampling?: {
    strategy: 'random' | 'latest' | 'errors-only';
    percent?: number; // for random
    count?: number;   // for latest
  };
  /** Custom span attribute mapping. Defaults handle OTel + OpenLLMetry. */
  spanFields?: SpanFieldsMap;
}

/**
 * Which canonical span field feeds an evaluator input slot.
 *
 * - `input` / `output` / `systemInstruction` / `model` map to the like-named
 *   span field.
 * - `userPrompt` is a synthetic field — the content of the latest prompt slot
 *   whose role is `user`. Useful for metrics like `user-frustration` that
 *   should score the user's turn in isolation, not the full conversation.
 */
export type CanonicalSpanField =
  | 'input'
  | 'output'
  | 'systemInstruction'
  | 'model'
  | 'userPrompt';

/** Per-metric override of which canonical span field flows into each evaluator input slot. */
export interface MetricInputs {
  input?: CanonicalSpanField;
  output?: CanonicalSpanField;
  context?: CanonicalSpanField;
}

/**
 * A metric entry in `metrics.enabled`. Either a string id (legacy form) or an
 * object with optional per-metric input routing.
 */
export type MetricEntry = string | { id: string; inputs?: MetricInputs };

export interface MetricsConfig {
  enabled: MetricEntry[];
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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract the metric id from a string-or-object MetricEntry. */
export function metricId(entry: MetricEntry): string {
  return typeof entry === 'string' ? entry : entry.id;
}

/** Per-metric input routing, or undefined if the entry is a bare string. */
export function metricInputs(entry: MetricEntry): MetricInputs | undefined {
  return typeof entry === 'string' ? undefined : entry.inputs;
}

/** Normalize a single-or-list candidate to a list. */
export function toCandidateList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
