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

Then install the peer dependency for your provider:

| Provider | Peer dependency |
|----------|-----------------|
| `openai`, `azure-openai` | `npm install openai` |
| `anthropic` | `npm install @anthropic-ai/sdk` |
| `vertex`, `gemini` | `npm install @google/genai` |
| `bedrock` | `npm install @aws-sdk/client-bedrock-runtime` |

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

Supports **OpenAI**, **Anthropic**, **Azure OpenAI**, **Google Gemini Enterprise Platform (Vertex AI)**, and **Amazon Bedrock**. Configure via explicit options in code or environment variables.

### Environment Variables

```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://your-proxy.example.com/v1  # optional

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://your-proxy.example.com  # optional

# Azure OpenAI (all three required)
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_VERSION=2024-02-01

# Google Gemini Enterprise Platform (Vertex AI) — ADC path (no API key needed)
GOOGLE_CLOUD_PROJECT=my-gcp-project
GOOGLE_CLOUD_LOCATION=us-central1  # optional, defaults to "global"

# Google Gemini Enterprise Platform (Vertex AI) — API key path
GOOGLE_API_KEY=AIza...

# Amazon Bedrock — static credentials (optional if using IAM roles / SSO)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1  # optional, defaults to "us-east-1"
```

Config is resolved in this order for each option:

1. Explicit value in `provider` options
2. Environment variable

### Google Gemini Enterprise Platform (Vertex AI) Setup

Use Application Default Credentials (ADC) with provider ID `vertex` when running on GKE or Cloud Run with Workload Identity, or pass `apiKey` with provider ID `gemini` for key-based auth.

### Azure OpenAI Setup

All four fields are required — `model` is your Azure deployment name, which is user-defined and has no default.

```ts
await evaluate(BuiltInMetric.Toxicity, input, {
  provider: {
    provider: "azure-openai",
    apiKey: "...",                                    // or AZURE_OPENAI_API_KEY
    baseUrl: "https://<resource>.openai.azure.com",  // or AZURE_OPENAI_ENDPOINT
    apiVersion: "2024-02-01",                         // or AZURE_OPENAI_API_VERSION
    model: "my-gpt4-deployment",                      // your deployment name
  },
});
```

### Amazon Bedrock Setup

Uses the AWS SDK credential chain — IAM roles, SSO, and `AWS_PROFILE` are all resolved automatically. Static credentials are only needed if you can't use role-based auth.

> **Note:** Google provider IDs `vertex` and `gemini` both use the `@google/genai` SDK; `azure-openai` and `openai` both use the `openai` SDK.

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
import type { EvalConfig, EvalInput } from "@dynatrace-oss/dt-eval-lib";

// What you pass to evaluate()
const input: EvalInput = {
  input: "What is the capital of France?",    // required — the user query
  output: "The capital of France is Paris.",  // required — the LLM response to evaluate
  context: "...",                              // optional — retrieved documents (RAG)
  expectedOutput: "...",                       // optional — reference answer
};

// How to run the evaluation
const config: EvalConfig = {
  provider: {
    provider: "openai",  // "openai" | "anthropic" | "azure-openai" | "vertex" | "gemini" | "bedrock"
    apiKey: "sk-...",    // optional if env var is set
    baseUrl: "https://", // optional — openai and anthropic only
    model: "...",        // optional — see src/engine/providers/index.ts for per-provider defaults
    timeout: 30000,      // optional — request timeout in ms (default: 30000)
    maxRetries: 2,       // optional — retries on transient errors (default: 2)
  },
  scoring: {
    thresholdOverride: 0.8, // optional — override the metric's pass threshold (default: 0.5)
  },
};
```
