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
    sampling: {
      strategy: 'random',
      percent: 100,
    },
  },
  metrics: {
    enabled: DEFAULT_METRICS,
  },
};

export const DEFAULT_JUDGE_MODELS: Record<string, string> = {
  openai: 'gpt-4.1',
  anthropic: 'claude-sonnet-4-6',
  vertex: 'gemini-2.5-pro',
  gemini: 'gemini-2.5-flash',
  // azure-openai: no default — deployment names are user-defined in Azure portal
  bedrock: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
};
