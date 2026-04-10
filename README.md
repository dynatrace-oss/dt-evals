# dt-eval

> **Note**
> This project is not officially supported by Dynatrace.

Open-source evaluation toolkit for LLM observability on Dynatrace.
Fetch GenAI traces instrumented through Dynatrace, score them with any AI judge,
and feed structured results back into Dynatrace — with zero manual wiring.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dt-eval-cli)](https://www.npmjs.com/package/dt-eval-cli)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

---

## Quickstart

Install the CLI, run the setup wizard, then evaluate your last hour of GenAI traces:

```bash
npm install -g dt-eval-cli
dt-eval-cli configure
dt-eval-cli run
```

`configure` walks you through connecting to your Dynatrace tenant and choosing an
AI provider (OpenAI, Anthropic, AWS Bedrock, or Google Gemini). After that, `run`
fetches spans from Grail, scores them, and writes results back as Dynatrace
business events — visible immediately in the AI Observability Evals tab.

---

## Table of Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running evals](#running-evals)
- [Built-in eval metrics](#built-in-eval-metrics)
- [Scheduling](#scheduling)
- [Alerting](#alerting)
- [Serverless deployment](#serverless-deployment)
- [CI/CD integration](#cicd-integration)
- [Eval result schema](#eval-result-schema)
- [Packages](#packages)
- [Contributing](#contributing)

---

## How it works

dt-eval is a pure pass-through pipeline — no prompt or response data is stored anywhere.

```
Dynatrace Grail (DQL)
        │
        ▼  fetch gen_ai.* spans
  Trace extraction
  + PII masking
        │
        ▼  build judge prompt per metric
  AI provider
  (OpenAI / Anthropic / Bedrock / Gemini)
        │
        ▼  normalized score + label + explanation
  Dynatrace BizEvents  ──►  AI Observability Evals tab
  Dynatrace Metrics    ──►  Davis AI alerting
```

Every eval result is correlated to its source span via `trace.id` and written using
the [OTEL GenAI evaluation semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

---

## Requirements

- Dynatrace Platform SaaS (DPS) with Grail enabled — DQL is required for trace fetching
- Node.js >= 20 LTS
- At least one AI provider credential: OpenAI, Anthropic, AWS Bedrock, or Google Gemini

---

## Installation

```bash
npm install -g dt-eval-cli
```

Or run without installing:

```bash
npx dt-eval-cli configure
```

---

## Configuration

```bash
dt-eval-cli configure
```

The wizard sets up:

- Dynatrace tenant URL and API token
- AI provider and credentials
- OpenPipeline ingest rules for `gen_ai.*` and `gen_ai.evaluation.*` OTEL attributes (via dtctl)

Configuration is stored in `~/.dt-eval/config.yaml`. A project-level `.dt-eval.yaml`
at repo root is merged on top and takes precedence.

```bash
dt-eval-cli configure --show   # print fully resolved config with secrets redacted
dt-eval-cli migrate            # auto-upgrade config to the current schema version
```

---

## Running evals

```bash
# evaluate the last hour of traces (default)
dt-eval-cli run

# customize the time window and sampling rate
dt-eval-cli run --since 6h --sample 10

# run a single metric
dt-eval-cli run --metric toxicity

# override the judge model for this run
dt-eval-cli run --model gpt-4o

# preview what would be sent — fetches and transforms traces, sends nothing
dt-eval-cli run --dry-run

# estimate token usage and cost per provider before committing
dt-eval-cli run --estimate
```

---

## Built-in eval metrics

dt-eval ships with five LLM-as-judge metrics out of the box. Each uses a
configurable judge prompt template with sensible defaults.

| Metric | What it measures | Score labels |
|--------|-----------------|--------------|
| `toxicity` | Harmful, offensive, or abusive language | `none` `low` `medium` `high` |
| `hallucination` | Unsupported claims relative to retrieved context | `none` `minor` `major` |
| `relevance` | Whether the response addresses the input | `high` `medium` `low` |
| `faithfulness` | Alignment with source/context provided | `faithful` `partially_faithful` `unfaithful` |
| `coherence` | Logical consistency and readability | `coherent` `incoherent` |

### Custom eval plugins

Install any `dt-eval-plugin-*` npm package and it is auto-discovered at runtime:

```bash
dt-eval-cli plugins add dt-eval-plugin-pii-score
dt-eval-cli plugins list
```

---

## Scheduling

Run evals on a cron schedule without keeping a process alive — deploy the runner as
a serverless function and configure the schedule from the CLI:

```bash
dt-eval-cli schedule set        # configure cron expression, sampling %, time window
dt-eval-cli schedule list       # list active schedules
dt-eval-cli schedule disable <id>
```

---

## Alerting

Define per-metric thresholds. When a score breaches a threshold, dt-eval fires
a webhook and publishes a metric time-series to Dynatrace Metrics API v2 for
Davis AI alerting.

```bash
dt-eval-cli alerts set          # define threshold rules per metric
dt-eval-cli alerts list         # show current rules and recent alert history
dt-eval-cli alerts test         # fire a synthetic alert to validate webhook delivery
```

Supported notification channels: Slack, PagerDuty, generic HTTP POST.

---

## Serverless deployment

Package and deploy the eval runner as a serverless function with a single command:

```bash
dt-eval-cli deploy --provider aws      # AWS Lambda
dt-eval-cli deploy --provider gcp      # Google Cloud Run
dt-eval-cli deploy --provider azure    # Azure Functions
dt-eval-cli deploy --teardown          # destroy deployed resources
```

Terraform modules are included in `dt-eval-deploy/terraform/{aws,gcp,azure}/`.
The deployed function instruments itself with OpenTelemetry and exports to your
configured Dynatrace endpoint.

---

## CI/CD integration

Use `--ci` for non-interactive pipelines. The command exits `0` if all scores are
within thresholds and `1` if any threshold is breached.

```bash
dt-eval-cli run --ci --since 24h --sample 5
```

Output is structured JSON on stdout when `--ci` is set, making it easy to parse
in downstream pipeline steps.

---

## Eval result schema

Every eval result is written as a Dynatrace business event following the
[OTEL GenAI evaluation semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

```jsonc
{
  // Dynatrace bizevent envelope
  "event.type": "dt-eval.result",
  "event.provider": "dt-eval-cli",
  "timestamp": "2026-03-11T10:00:00Z",

  // Correlation to source GenAI span
  "trace.id": "abc123...",
  "dt.eval.run_id": "run-20260311-abc",

  // OTEL GenAI Evaluation attributes
  "gen_ai.evaluation.name": "toxicity",
  "gen_ai.evaluation.score.value": 0.12,
  "gen_ai.evaluation.score.label": "low",
  "gen_ai.evaluation.explanation": "No harmful content detected.",

  // Judge metadata
  "gen_ai.evaluation.judge.provider": "openai",
  "gen_ai.evaluation.judge.model": "gpt-4o-2024-11-20",

  // Source span metadata
  "gen_ai.system": "openai",
  "gen_ai.request.model": "gpt-4o-mini"
}
```

---

## Packages

This is a monorepo. All packages are under Apache-2.0.

| Package | Description |
|---------|-------------|
| [`dt-eval-cli`](dt-eval-cli/) | CLI — `configure`, `run`, `schedule`, `alerts`, `deploy` commands |
| [`dt-eval-lib`](dt-eval-lib/) | Shared types, judge prompt templates, score normalization, plugin hooks |
| [`dt-eval-instrument`](dt-eval-instrument/) | OTEL self-monitoring — emits traces and metrics for eval runs themselves |
| [`dt-eval-deploy`](dt-eval-deploy/) | Serverless packaging and Terraform modules (Lambda / Cloud Run / Azure Functions) |

---

## Contributing

Contributions are welcome. Please open an issue before submitting a large PR.

Released under [Apache 2.0](LICENSE) in the [Dynatrace OSS](https://github.com/dynatrace-oss) GitHub organization.
