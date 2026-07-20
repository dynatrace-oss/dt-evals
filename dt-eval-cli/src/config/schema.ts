export const CURRENT_SCHEMA_VERSION = 2;

/** A single Dynatrace tenant endpoint (origin for reads, destination for writes). */
export interface DynatraceEndpoint {
  environmentUrl: string;
  apiToken?: string;
}

/**
 * Dynatrace connectivity. Two shapes are supported and merged:
 *
 *   1. Single-tenant (legacy): `environmentUrl` + `apiToken` at the top level.
 *   2. Cross-tenant: `origin` (read) and `destination` (write) endpoints. When
 *      either is omitted, the top-level fields are used as a fallback.
 */
export interface DynatraceConfig extends Partial<DynatraceEndpoint> {
  /** Tenant to fetch GenAI spans from (DQL read). Falls back to the top-level fields. */
  origin?: Partial<DynatraceEndpoint>;
  /** Tenant to write evaluation bizevents/metrics to. Falls back to the top-level fields. */
  destination?: Partial<DynatraceEndpoint>;
}

export interface JudgeConfig {
  provider: 'openai' | 'anthropic' | 'azure-openai' | 'gemini' | 'vertex' | 'bedrock';
  /** API key. For Bedrock: AWS access key ID. Optional for Vertex AI when using Workload Identity / ADC. */
  apiKey?: string;
  /** For Bedrock: AWS secret access key. Falls back to AWS_SECRET_ACCESS_KEY env var. */
  secretKey?: string;
  /** For azure-openai: endpoint URL (e.g. https://my-resource.openai.azure.com/). Falls back to AZURE_OPENAI_ENDPOINT. */
  baseUrl?: string;
  /** For azure-openai: API version (e.g. 2025-04-01-preview). Falls back to AZURE_OPENAI_API_VERSION. Required for azure-openai. */
  apiVersion?: string;
  /** For vertex: GCP project ID. Falls back to GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT env vars. */
  project?: string;
  /** For vertex: GCP region (e.g. global or us-central1). Falls back to GOOGLE_CLOUD_LOCATION env var. Default: global. */
  location?: string;
  model?: string;
  timeout?: number;
  maxRetries?: number;
  /**
   * Number of judge calls to run in parallel. Higher values speed up large runs
   * but increase pressure on the provider's rate limits. Default: 5.
   * Overridable per-invocation with `--concurrency`.
   */
  concurrency?: number;
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
 * - `userPrompt` is a synthetic field — the latest extracted user message.
 *   Useful for metrics like `user-frustration` that
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
  /**
   * Include the evaluated prompt and response — `gen_ai.evaluation.input.question`,
   * `.answer`, and `.system_prompt` — in the bizevents written back to Dynatrace.
   * Default: false. Overridable per-invocation with `--store-evaluated-prompt`.
   */
  storeEvaluatedPrompt?: boolean;
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

/**
 * Resolve concrete origin (read) and destination (write) endpoints from a
 * config block. Top-level `environmentUrl`/`apiToken` act as defaults for
 * either side when `origin` or `destination` is partial or missing.
 */
export function resolveEndpoints(dt: DynatraceConfig): {
  origin: DynatraceEndpoint;
  destination: DynatraceEndpoint;
} {
  const fallback: Partial<DynatraceEndpoint> = {
    environmentUrl: dt.environmentUrl,
    apiToken: dt.apiToken,
  };
  const merge = (side: Partial<DynatraceEndpoint> | undefined): DynatraceEndpoint => ({
    environmentUrl: side?.environmentUrl ?? fallback.environmentUrl ?? '',
    apiToken: side?.apiToken ?? fallback.apiToken,
  });
  return { origin: merge(dt.origin), destination: merge(dt.destination) };
}
