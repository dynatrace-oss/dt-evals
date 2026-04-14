# dt-eval-lib

Minimal TypeScript library for running LLM-as-a-judge evaluations.

## Install

```bash
npm install
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
import { evaluate, BuiltInMetric } from "dt-eval-lib";

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

| Metric | Enum | Type | Required Fields |
|--------|------|------|-----------------|
| `toxicity` | `BuiltInMetric.Toxicity` | binary | input, output |
| `faithfulness` | `BuiltInMetric.Faithfulness` | continuous | input, output, context |
| `hallucination` | `BuiltInMetric.Hallucination` | binary | input, output, context |
| `pii-leakage` | `BuiltInMetric.PiiLeakage` | binary | input, output |
| `relevance` | `BuiltInMetric.Relevance` | continuous | input, output |
| `factual-accuracy` | `BuiltInMetric.FactualAccuracy` | continuous | input, output, expectedOutput |
| `coherence` | `BuiltInMetric.Coherence` | likert (1-5) | input, output |
| `context-relevance` | `BuiltInMetric.ContextRelevance` | continuous | input, context |
| `answer-completeness` | `BuiltInMetric.AnswerCompleteness` | continuous | input, output |
| `prompt-injection` | `BuiltInMetric.PromptInjection` | binary | input, output |
| `bias` | `BuiltInMetric.Bias` | binary | input, output |
| `summarization-quality` | `BuiltInMetric.SummarizationQuality` | continuous | input, output |
| `conciseness` | `BuiltInMetric.Conciseness` | continuous | input, output |

> **Note:** The "Required Fields" column lists the `EvalInput` property names you pass to `evaluate()`.

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
import { evaluate, BuiltInMetric } from "dt-eval-lib";

await evaluate(BuiltInMetric.Toxicity, input, config);   // built-in metric via enum
await evaluate(myCustomPrompt, input, config);             // custom PromptDefinition object
```

Use `listPrompts()` and `getPrompt()` to discover available metrics:

```ts
import { listPrompts, getPrompt, BuiltInMetric } from "dt-eval-lib";

const all = listPrompts();                        // all 13 built-in metrics
const tox = getPrompt(BuiltInMetric.Toxicity);    // single metric by ID
```

## Configuration

```ts
import type { EvalConfig } from "dt-eval-lib";

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
