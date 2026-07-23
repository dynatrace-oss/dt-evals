# dt-eval-lib

[![npm version](https://img.shields.io/npm/v/@dynatrace-oss/dt-eval-lib/alpha?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/@dynatrace-oss/dt-eval-lib)
[![npm downloads](https://img.shields.io/npm/dm/@dynatrace-oss/dt-eval-lib?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@dynatrace-oss/dt-eval-lib)
[![Build](https://github.com/dynatrace-oss/dt-evals/actions/workflows/ci-lib.yml/badge.svg?branch=main)](https://github.com/dynatrace-oss/dt-evals/actions/workflows/ci-lib.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](../LICENSE)

Minimal TypeScript library for running LLM-as-a-judge evaluations.

## Install

```bash
npm install @dynatrace-oss/dt-eval-lib
```

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Quick Usage

```ts
import { evaluate, BuiltInMetric } from "@dynatrace-oss/dt-eval-lib";

const result = await evaluate(
  BuiltInMetric.Toxicity,
  {
    input: "Tell me a joke",
    output: "Why did the chicken cross the road? To get to the other side!",
  },
  {
    provider: {
      provider: "openai",
      apiKey: "sk-...",
    },
  },
);

console.log(result.score);       // { value: 1, label: "pass" }
console.log(result.explanation); // { summary: "...", reasoning: "..." }
```

## Available Metrics

All built-in metrics return a **continuous** score in `[0.0, 1.0]`. The score is labeled `"pass"` when `value >= threshold` and `"fail"` otherwise. Every built-in metric defaults to `threshold: 0.5` — override it per-call via `EvalConfig.scoring.thresholdOverride`. Source of truth: [`src/prompts/catalog-data.ts`](src/prompts/catalog-data.ts).

| Metric | Enum | Score range | Fields used from `EvalInput` |
|--------|------|-------------|-------------------------------|
| `answer-completeness` | `BuiltInMetric.AnswerCompleteness` | 0.0 – 1.0 | `input`, `output` |
| `bias` | `BuiltInMetric.Bias` | 0.0 – 1.0 | `input`, `output` |
| `conciseness` | `BuiltInMetric.Conciseness` | 0.0 – 1.0 | `input`, `output` |
| `context-relevance` | `BuiltInMetric.ContextRelevance` | 0.0 – 1.0 | `input` |
| `factual-accuracy` | `BuiltInMetric.FactualAccuracy` | 0.0 – 1.0 | `input`, `output` |
| `faithfulness` | `BuiltInMetric.Faithfulness` | 0.0 – 1.0 | `input`, `output` |
| `fluency` | `BuiltInMetric.Fluency` | 0.0 – 1.0 | `input`, `output` |
| `hallucination` | `BuiltInMetric.Hallucination` | 0.0 – 1.0 | `input`, `output` |
| `pii-leakage` | `BuiltInMetric.PiiLeakage` | 0.0 – 1.0 | `input`, `output` |
| `prompt-injection` | `BuiltInMetric.PromptInjection` | 0.0 – 1.0 | `input` |
| `relevance` | `BuiltInMetric.Relevance` | 0.0 – 1.0 | `input`, `output` |
| `summarization-quality` | `BuiltInMetric.SummarizationQuality` | 0.0 – 1.0 | `input`, `output` |
| `toxicity` | `BuiltInMetric.Toxicity` | 0.0 – 1.0 | `output` |
| `user-frustration` | `BuiltInMetric.UserFrustration` | 0.0 – 1.0 | `input` |

> **Note:** The "Fields used" column lists which fields the metric prompt actually reads. `EvalInput.output` is required at the TypeScript type level for all calls — pass `output: ""` for metrics that only use `input`.

## Providers

Supports **OpenAI**, **Anthropic**, **Vertex AI**, and **Gemini Developer API**. Configure via API key in code or environment variables.

### Environment Variables

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://your-proxy.example.com/v1"  # optional

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
export ANTHROPIC_BASE_URL="https://your-proxy.example.com"  # optional

# Google AI (Vertex AI & Gemini) — API key
export GOOGLE_API_KEY="AIza..."
```

Or use a `.env` file (not committed to git):

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_BASE_URL=https://your-proxy.example.com/v1
ANTHROPIC_BASE_URL=https://your-proxy.example.com
GOOGLE_API_KEY=AIza...
```

### Vertex AI Setup

1. Get an API key from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Vertex AI Express Mode)
2. Set `GOOGLE_API_KEY` env var (or pass `apiKey` in provider config)

```ts
await evaluate(BuiltInMetric.Toxicity, input, {
  provider: {
    provider: "vertex",
    apiKey: "AQ...",
  },
});
```

### Gemini Developer API Setup

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Set `GOOGLE_API_KEY` env var (or pass `apiKey` in provider config)

```ts
await evaluate(BuiltInMetric.Toxicity, input, {
  provider: {
    provider: "gemini",
    apiKey: "AIza...",
  },
});
```

> **Note:** Both `vertex` and `gemini` use the `@google/genai` SDK and require Node.js ≥ 20.

When calling `evaluate()`, the library resolves config in this order:

1. Explicit value in `provider` options (e.g., `provider.apiKey`, `provider.baseUrl`)
2. Environment variable (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, etc.)

```ts
// Option 1: explicit config
await evaluate(BuiltInMetric.Toxicity, input, {
  provider: {
    provider: "openai",
    apiKey: "sk-...",
    baseUrl: "https://your-proxy.example.com/v1",
  },
});

// Option 2: env vars (no apiKey/baseUrl needed)
await evaluate(BuiltInMetric.Toxicity, input, {
  provider: { provider: "openai" },
});
```

## Metric Identification

Metrics are identified by the `BuiltInMetric` enum. You can also pass a custom `PromptDefinition` object directly:

```ts
import { evaluate, BuiltInMetric } from "@dynatrace-oss/dt-eval-lib";

await evaluate(BuiltInMetric.Toxicity, input, config);   // built-in metric via enum
await evaluate(myCustomPrompt, input, config);             // custom PromptDefinition object
```

Use `listPrompts()` and `getPrompt()` to discover available metrics:

```ts
import { listPrompts, getPrompt, BuiltInMetric } from "@dynatrace-oss/dt-eval-lib";

const all = listPrompts();                        // all 14 built-in metrics
const tox = getPrompt(BuiltInMetric.Toxicity);    // single metric by ID
```

## Configuration

```ts
import type { EvalConfig } from "@dynatrace-oss/dt-eval-lib";

const config: EvalConfig = {
  provider: {
    provider: "openai",          // "openai" | "anthropic" | "vertex" | "gemini"
    apiKey: "sk-...",            // optional if env var is set
    baseUrl: "https://...",      // optional (openai/anthropic only)
    model: "gpt-4.1",           // optional — defaults to gpt-4.1 / claude-sonnet-4-6 / gemini-2.5-pro (vertex) / gemini-2.5-flash (gemini)
    timeout: 30000,              // optional — request timeout in ms (default 30000)
    maxRetries: 2,               // optional — retries on transient errors (default 2)
  },
  scoring: {
    thresholdOverride: 0.8,      // optional — override the metric's default threshold
  },
};
```

## Threshold Override

```ts
const result = await evaluate(BuiltInMetric.Relevance, input, {
  provider: { provider: "openai", apiKey: "sk-..." },
  scoring: { thresholdOverride: 0.8 }, // stricter than default 0.5
});
```
