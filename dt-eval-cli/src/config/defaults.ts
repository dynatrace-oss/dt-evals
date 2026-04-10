import { CURRENT_SCHEMA_VERSION, type DtEvalConfig } from './schema.js';

// All built-in LLM-as-judge metrics available in dt-eval-lib + drift
export const ALL_METRICS = [
  'toxicity',
  'faithfulness',
  'hallucination',
  'pii-leakage',
  'relevance',
  'factual-accuracy',
  'coherence',
  'context-relevance',
  'answer-completeness',
  'prompt-injection',
  'bias',
  'summarization-quality',
  'conciseness',
  'drift',
];

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
  },
  scope: {
    since: '1h',
    sampling: {
      strategy: 'random',
      percent: 5,
    },
  },
  metrics: {
    enabled: ALL_METRICS,
  },
};

export const DEFAULT_JUDGE_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
};
