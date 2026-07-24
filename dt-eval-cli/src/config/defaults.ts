import { CURRENT_SCHEMA_VERSION, type DtEvalConfig } from './schema.js';

// All built-in LLM-as-judge metrics available in dt-eval-lib
export const ALL_METRICS = [
  'fluency',
  'toxicity',
  'faithfulness',
  'hallucination',
  'pii-leakage',
  'relevance',
  'factual-accuracy',
  'user-frustration',
  'context-relevance',
  'answer-completeness',
  'prompt-injection',
  'bias',
  'summarization-quality',
  'conciseness',
];

// Sensible starter set — users can expand via dt-evals configure
export const DEFAULT_METRICS = ['toxicity', 'relevance', 'faithfulness'];

export const DEFAULT_OPERATION_NAMES = ['chat', 'text_completion', 'generate_content'];

export const DEFAULT_CONFIG: Omit<DtEvalConfig, 'dynatrace' | 'judge'> & {
  dynatrace: Partial<DtEvalConfig['dynatrace']>;
  judge: Partial<DtEvalConfig['judge']>;
} = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  dynatrace: {
    environmentUrl: '',
  },
  judge: {
    provider: 'openai',
    timeout: 30000,
    maxRetries: 2,
    concurrency: 5,
  },
  scope: {
    since: '1h',
    operationNames: DEFAULT_OPERATION_NAMES,
    sampling: {
      strategy: 'random',
      percent: 5,
    },
  },
  metrics: {
    enabled: DEFAULT_METRICS,
  },
};

export const DEFAULT_JUDGE_MODELS: Record<string, string> = {
  openai: 'gpt-5-mini',
  anthropic: 'claude-sonnet-4-6',
  vertex: 'gemini-3.1-flash-lite',
  gemini: 'gemini-3.1-flash-lite',
  // azure-openai: no default — deployment names are user-defined in Azure portal
  bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
};

/**
 * Suggests the model to pre-fill in the configure wizard's model prompt.
 *
 * Only reuses a previously configured model when the user stays on the same
 * provider — otherwise the provider-specific default is suggested. This
 * prevents carrying over one provider's model (e.g. an OpenAI default filled
 * in by resolveEffectiveConfig) when the user switches to another provider.
 * Returns '' when no default exists (e.g. azure-openai deployment names).
 */
export function suggestModelForProvider(
  provider: DtEvalConfig['judge']['provider'],
  existingProvider?: DtEvalConfig['judge']['provider'],
  existingModel?: string,
): string {
  if (existingProvider === provider && existingModel) {
    return existingModel;
  }
  return DEFAULT_JUDGE_MODELS[provider] ?? '';
}
