# dt-evals - Dynatrace Evaluation CLI tool

**Open source continuous evals for LLM applications, with production prompt traces as the dataset.**

[![npm version](https://img.shields.io/npm/v/@dynatrace-oss/dt-evals/alpha?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/@dynatrace-oss/dt-evals)
[![npm downloads](https://img.shields.io/npm/dm/@dynatrace-oss/dt-evals?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@dynatrace-oss/dt-evals)
[![Build](https://github.com/dynatrace-oss/dt-evals/actions/workflows/ci-cli.yml/badge.svg?branch=main)](https://github.com/dynatrace-oss/dt-evals/actions/workflows/ci-cli.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/node/v/@dynatrace-oss/dt-evals/alpha?style=flat-square)](package.json)

![dt-evals welcome](../assets/dt-evals-welcome.gif)

`dt-evals` is for teams shipping chat, RAG, copilots, and agent workflows who want evals to run on real traffic, not just curated test sets.

Today, the CLI uses Dynatrace as both the trace source and the evaluation result store. It pulls gen_ai.* spans from your live environment, masks sensitive data in memory, scores real production interactions with an LLM judge, detects score drift over time, and writes structured evaluation results back to Dynatrace as business events.

That means when a score drops or an outlier appears, you do not just see that quality regressed, you can trace it back through the full AI execution path: prompts, retrieval context, model calls, tool usage, latency, failures, and service dependencies.

In practice, this gives AI engineers a closed loop for evaluation, observability, alerting, anomaly detection, and remediation on the same production telemetry they already use to operate their systems.

The repository also includes `dt-eval-lib`, a reusable TypeScript evaluation engine for running the same judge-based metrics directly in code, using either the built-in evaluator catalog or your own custom prompt definitions. It also fits cleanly into broader evaluation workflows and observability stacks such as Ragas, MLflow, or Langfuse when you want to orchestrate or track evals in those systems alongside this library.

```bash
npx @dynatrace-oss/dt-evals configure
npx @dynatrace-oss/dt-evals validate
npx @dynatrace-oss/dt-evals run --since 1h --sample 10 --concurrency 10
```

Tune `--concurrency` (or `judge.concurrency` in your yaml) to control how many judge calls run in parallel — bump it for faster runs, drop it if the provider rate-limits you. Default is 5.

> 🎮 **See it live before installing** — [**open the dt-evals playground dashboard**](http://wkf10640.apps.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard/monaco-2cf9a79b-8b32-3244-aed1-e9d8c6e3e6a8) on our public Dynatrace tenant. Real evaluation runs against production GenAI traces — scores per metric, drift over time, threshold breaches, click-through to the originating trace.

## Why Teams Use It

- Run evals on real production traces, not static test sets
- Keep eval results in Dynatrace with traces, logs, metrics, dashboards, and alerts
- Catch common LLM and agent failure modes with built-in judge metrics
- Detect regressions, drift, and outlier score changes early
- Go from low score to root cause with end-to-end AI observability
- Correlate failures with prompts, retrieval, tool calls, latency, and dependencies
- Reuse the same evaluator catalog in CI, app code, and local workflows with dt-eval-lib
- Trigger alerts and optional remediation from the same evaluation pipeline

## Packages

| Package | What it is for |
|---------|-----------------|
| `dt-evals` | Continuous evaluation runs against production GenAI traces in Dynatrace |
| `dt-eval-lib` | TypeScript library for judge-based evals inside tests, scripts, and app code |
| `dt-eval-engine` | Core runtime for deployed eval workers and serverless runners |

## What It Does

- **14 built-in judge metrics** for safety, grounding, relevance, quality, and retrieval quality
- **Statistical drift detection** against a 7 day baseline of prior evaluation scores
- **Flexible sampling** with random percentage, latest `N`, or `errors-only`
- **PII masking before judge calls** for emails, phone numbers, credit cards, and SSNs
- **Evaluated prompt/response excluded from bizevents by default** — opt in with `storeEvaluatedPrompt` (see [Configuration](#configuration))
- **OpenAI, Anthropic, Azure OpenAI, Google Gemini Enterprise Platform (Vertex AI), and Bedrock support** with optional custom base URLs for gateways and proxies
- **CI friendly runs** with JSON output and non-zero exit codes on threshold breaches
- **Local run history** with list, inspect, and export flows
- **Scheduled runs** stored locally and triggerable on demand
- **Evaluator inspection and testing** from the CLI
- **TypeScript API** for running the evaluator catalog directly in code

## How It Works

```text
Dynatrace spans (gen_ai.*)
        |
        v
sample traces -> mask sensitive data -> score with LLM judge -> write business events
                                                                    |
                                                                    v
                                             query in DQL, dashboard, alert, export
```

The current CLI path is Dynatrace specific. The product positioning is broader: continuous evals for AI-native engineering teams, using your live LLM traffic as the source of truth.

## Requirements

- Node.js `>=20`
- A Dynatrace environment with GenAI spans or OpenTelemetry-style `gen_ai.*` fields
- Credentials for your judge provider (OpenAI, Anthropic, Azure OpenAI, Google Gemini Enterprise Platform (Vertex AI), or Bedrock)

## Install

```bash
npm install -g @dynatrace-oss/dt-evals
```

Or run without installing:

```bash
npx @dynatrace-oss/dt-evals <command>
```

The CLI also auto-loads a local `.env` file from the current working directory.

## Quick Start

### 1. Create config

Interactive setup:

```bash
dt-evals configure
```

Non-interactive setup:

```bash
dt-evals configure \
  --env-url https://your-env.live.dynatrace.com \
  --api-token "$DT_API_TOKEN" \
  --provider openai \
  --api-key "$OPENAI_API_KEY" \
  --model gpt-4.1 \
  --since 1h \
  --output .dt-eval.yaml
```

### 2. Validate the setup

```bash
dt-evals validate
```

This checks:

- config schema
- Dynatrace connectivity
- judge provider reachability
- evaluator catalog availability

### 3. Run evals on recent traces

```bash
dt-evals run --since 1h --sample 10 --concurrency 5
```

Run only one evaluator:

```bash
dt-evals run --since 6h --metric faithfulness
```

Preview the work without calling the judge or writing results:

```bash
dt-evals run --since 1h --sample 5 --dry-run
```

## CLI Workflows

### Production eval run

```bash
dt-evals run \
  --since 2h \
  --sample 20 \
  --concurrency 8 \
  --debug
```

### CI gate on quality regressions

```bash
dt-evals run --since 6h --metric relevance --ci
```

- exit code `0`: no threshold breaches
- exit code `1`: one or more threshold breaches

Example GitHub Actions step:

```yaml
- name: Run LLM eval gate
  run: npx @dynatrace-oss/dt-evals run --since 6h --metric faithfulness --ci
  env:
    DT_ENV_URL: ${{ secrets.DT_ENV_URL }}
    DT_API_TOKEN: ${{ secrets.DT_API_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Run drift detection only

```bash
dt-evals run --metric drift --since 24h
```

This uses prior evaluation results already written to Dynatrace and compares the recent window against a 7 day baseline.

### Inspect available evaluators

```bash
dt-evals evaluators list
dt-evals evaluators show faithfulness
dt-evals evaluators test relevance
```

Create or remove a custom evaluator:

```bash
dt-evals evaluators add
dt-evals evaluators delete my-custom-eval
```

### Manage run history

```bash
dt-evals runs list --limit 20
dt-evals runs show run-2026-04-10T12-00-00-ab12cd34
dt-evals runs export --format csv --output runs.csv
```

Run records are stored locally in `~/.dt-eval/runs.json`.

### Schedule recurring runs

```bash
dt-evals schedule add --name hourly-rag --cron "0 * * * *" --since 1h --sample 10
dt-evals schedule list
dt-evals schedule run <schedule-id>
dt-evals schedule disable <schedule-id>
dt-evals schedule enable <schedule-id>
dt-evals schedule delete <schedule-id>
```

Schedules are stored locally in `~/.dt-eval/schedules.json`.

### Check current status

```bash
dt-evals status
dt-evals configure --show
```

## Commands

| Command | Description |
|---------|-------------|
| `configure` | Create or update config interactively or via flags |
| `validate` | Check config, Dynatrace connectivity, and judge provider availability |
| `run` | Evaluate recent GenAI traces |
| `status` | Show resolved config, connectivity, and last run summary |
| `evaluators` | List, inspect, test, and manage evaluators |
| `runs` | View and export historical run records |
| `schedule` | Create and trigger recurring runs |

Global flags:

```text
--verbose    Enable verbose logs
--json       Emit structured JSON logs
```

`run` flags:

```text
--config <path>        Path to config file
--since <duration>     Trace lookback window, for example 1h or 24h
--sample <percent>     Percentage of traces to evaluate
--metric <name>        Run only one evaluator
--dry-run              Do not call the judge or write results
--ci                   JSON result output and exit 1 on threshold breach
--concurrency <n>      Parallel judge calls (overrides judge.concurrency in the config; default 5)
--store-evaluated-prompt   Include the evaluated prompt/response in bizevents (overrides storeEvaluatedPrompt in the config; default: false)
--debug                Per-step timing logs
```

## Configuration

Config is resolved in this order:

| Priority | Source |
|----------|--------|
| 1 | Environment variables |
| 2 | Project config, usually `.dt-eval.yaml` |
| 3 | Global config, `~/.dt-eval/config.yaml` |
| 4 | Built-in defaults |

### Example config

```yaml
schemaVersion: 2
name: travel-assistant-prod

dynatrace:
  environmentUrl: https://your-env.live.dynatrace.com
  dtctlContext: my-prod-context

judge:
  provider: openai
  model: gpt-4.1
  timeout: 30000
  maxRetries: 2
  concurrency: 5

scope:
  service: travel-assistant
  since: 1h
  sampling:
    strategy: random
    percent: 10

metrics:
  enabled:
    - faithfulness
    - hallucination
    - relevance
    - answer-completeness
    - drift

alerts:
  thresholds:
    faithfulness: 0.7
    relevance: 0.7
    answer-completeness: 0.8

storeEvaluatedPrompt: false
```

Sampling strategies:

| Strategy | Example |
|----------|---------|
| Random percentage | `strategy: random`, `percent: 10` |
| Most recent traces | `strategy: latest`, `count: 200` |
| Error traces only | `strategy: errors-only` |

### Cross-tenant configuration

`dynatrace.environmentUrl` / `dynatrace.apiToken` describe a single tenant
that handles both reads and writes. To split them — fetch GenAI spans from
one tenant and write evaluation bizevents to another — use `origin` (read)
and `destination` (write):

```yaml
dynatrace:
  origin:
    environmentUrl: https://prod.live.dynatrace.com
  destination:
    environmentUrl: https://eval-results.dev.apps.dynatracelabs.com
```

Top-level `environmentUrl` / `apiToken` (if present) act as fallbacks — if
either side omits a field, the top-level value is used. So a single-tenant
config is just the cross-tenant form with both sides empty.

The `validate` command probes each side separately, including a real
`fetch spans | limit 1` against the origin to catch missing
`storage:spans:read` scope before a run is attempted.

### Required token scopes

| Scope | Required for |
|---|---|
| `storage:spans:read` | Reading GenAI spans (origin) |
| `storage:buckets:read` | Grail prerequisite — without this, DQL returns empty results silently |
| `storage:bizevents:read` | Drift detection baseline (reads past eval bizevents) |
| `storage:events:write` | Writing evaluation results as bizevents (destination) |
| `storage:metrics:write` | Writing evaluation metrics *(optional)* |
| `storage:logs:read` | `dt-evals validate` connectivity probe |

For `dt-evals alerts apply` (Dynatrace Workflows), grant these additionally on the dtctl OAuth client:

| Scope | Required for |
|---|---|
| `automation:workflows:read` | `list`, `diff`, idempotent `apply` |
| `automation:workflows:write` | `apply`, `delete` |
| `automation:workflows:run` | Manual execution from the UI *(optional)* |

### Custom span field mapping

By default, the CLI reads OTel GenAI semconv (`gen_ai.input.messages`,
`gen_ai.output.messages`, `gen_ai.output.message`, …). It also probes a
small set of legacy fallback attributes (`gen_ai.prompt.N.*`,
`gen_ai.completion.0.content`) for compatibility with older emitters. If
your spans expose the LLM I/O under different attribute names — for
example OpenInference (`llm.input_messages`, `llm.output_messages`,
`llm.model_name`) — point the CLI at them via `scope.spanFields`. See the
[`dynatrace-ai-agent-instrumentation-examples`](https://github.com/dynatrace-oss/dynatrace-ai-agent-instrumentation-examples)
for end-to-end instrumentation examples.
Each entry accepts a single attribute or a list of candidates; the first
non-null value wins, with the built-in defaults appended as fallback.

**Example 1 — OTel GenAI variant** (some Bedrock / Vertex SDK emitters
serialize the full message array under the plural attribute
`gen_ai.output.messages` instead of the singular
`gen_ai.output.message`):

```yaml
scope:
  service: pydantic-ai-music-agent
  spanFields:
    output: [gen_ai.output.message, gen_ai.output.messages]
```

The runner stringifies whatever it finds, so a JSON array under
`gen_ai.output.messages` reaches the judge as the assistant turn(s).
This is still OTel GenAI-compatible — `spanFields` just lets you handle
emitter-specific variants explicitly.

**Example 2 — OTel spans not following the GenAI SemConv (OpenInference):**

```yaml
scope:
  service: my-openinference-service
  since: 30m
  spanFields:
    input: [llm.input_messages, input.value]
    output: [llm.output_messages, output.value]
    model: llm.model_name
```

OpenInference usually stores chat turns in `llm.input_messages` /
`llm.output_messages` and plain-text payloads in `input.value` /
`output.value`, so listing both keeps the mapping resilient across
instrumentations.

### Per-metric input routing

Metric entries in `metrics.enabled` accept either a string id (the legacy
form) or an object with `inputs` that overrides which canonical span field
feeds each evaluator input slot. This is useful when a metric should score
only part of the conversation — e.g. `user-frustration` evaluates the user's
turn in isolation, not the joined transcript:

```yaml
metrics:
  enabled:
    - faithfulness                                  # plain string form
    - id: user-frustration
      inputs:
        input: userPrompt
    - id: hallucination
      inputs:
        context: context
```

Available canonical fields: `input`, `output`, `context`,
`systemInstruction`, `model`, `userPrompt` (latest user-role prompt slot, extracted from
`gen_ai.prompt.N.role == "user"`). `context` has no built-in default span
attribute — if a span does not provide it, evaluator context is omitted unless
you explicitly route `inputs.context` elsewhere.

### Full example

A complete `.dt-eval.yaml` combining everything — schema bump, custom
span field mapping, per-metric input routing, sampling, alerts:

```yaml
schemaVersion: 2
name: travel-assistant-prod

dynatrace:
  environmentUrl: https://your-env.live.dynatrace.com
  # apiToken loaded from DT_API_TOKEN env var

judge:
  provider: azure-openai
  model: gpt-4.1-mini
  # apiKey, baseUrl, apiVersion loaded from AZURE_OPENAI_* env vars

scope:
  service: travel-assistant
  since: 1h
  sampling:
    strategy: latest
    count: 50
  spanFields:
    context: span.context
    output: [gen_ai.output.message, gen_ai.output.messages]
    # input, systemInstruction, model use built-in defaults

metrics:
  enabled:
    - faithfulness
    - relevance
    - hallucination
    - answer-completeness
    - id: user-frustration
      inputs:
        input: userPrompt

alerts:
  thresholds:
    faithfulness: 0.7
    relevance: 0.7
    answer-completeness: 0.8
    user-frustration: 1
```

Useful environment variables:

```bash
DT_ENV_URL=https://your-env.live.dynatrace.com
DT_API_TOKEN=dt0c01.xxxxx
DT_DTCTL_CONTEXT=my-prod-context

# Cross-tenant overrides (optional — when set, these win over the top-level pair)
DT_ORIGIN_ENV_URL=https://prod.live.dynatrace.com
DT_ORIGIN_API_TOKEN=dt0s16.xxxxx
DT_DESTINATION_ENV_URL=https://eval-results.dev.apps.dynatracelabs.com
DT_DESTINATION_API_TOKEN=dt0s16.yyyyy

JUDGE_PROVIDER=openai
JUDGE_MODEL=gpt-4.1

OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://your-gateway.example.com/v1

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://your-proxy.example.com

# Google Gemini Enterprise Platform (Vertex AI)
GOOGLE_API_KEY=...
# Or authenticate via Workload Identity / Application Default Credentials instead of an API key.
# Set the target project and region (or judge.project / judge.location in config):
GOOGLE_CLOUD_PROJECT=my-gcp-project
GOOGLE_CLOUD_LOCATION=global
```

## Results in Dynatrace

Evaluation results are written as business events with `event.type == "gen_ai.evaluation.result"`.

Important fields include:

| Field | Meaning |
|-------|---------|
| `gen_ai.evaluation.name` | Evaluator name, for example `faithfulness` |
| `gen_ai.evaluation.score.value` | Numeric score |
| `gen_ai.evaluation.score.label` | `pass` or `fail` |
| `gen_ai.evaluation.score.explanation` | Short summary from the judge |
| `dt.eval.run_id` | Evaluation run identifier |
| `trace_id` | Source trace ID |
| `dt.service.name` | Service filter when configured |

Example DQL:

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
| summarize avg_score = avg(gen_ai.evaluation.score.value), by: { gen_ai.evaluation.name }
| sort avg_score asc
```

Drift results are written back as the same event type with `gen_ai.evaluation.type == "drift"`.

## Built-in Evaluators

`dt-evals` ships with 14 built-in LLM judge evaluators, plus drift detection as a separate statistical metric.

| Evaluator | Measures | Fields used |
|-----------|----------|-------------|
| `answer-completeness` | Whether all parts of the request were answered | `input`, `output` |
| `bias` | Harmful bias or unfair framing | `input`, `output` |
| `conciseness` | Whether the answer avoids filler and unnecessary padding | `input`, `output` |
| `context-relevance` | Retrieval quality for supplied context | `input` |
| `factual-accuracy` | Accuracy using world knowledge | `input`, `output` |
| `faithfulness` | Whether the answer is grounded in provided context | `input`, `output` |
| `fluency` | Grammar, clarity, and natural language quality | `input`, `output` |
| `hallucination` | Unsupported or fabricated claims | `input`, `output` |
| `pii-leakage` | Personally identifiable information in the answer | `input`, `output` |
| `prompt-injection` | Prompt injection attempts in the input | `input` |
| `relevance` | Whether the answer addresses the user request | `input`, `output` |
| `summarization-quality` | Summary faithfulness, coverage, and conciseness | `input`, `output` |
| `toxicity` | Harmful, offensive, or unsafe output | `output` |
| `user-frustration` | Frustration signals in the user's message | `input` |

### Custom evaluators

You can create a custom judge metric with `dt-evals evaluators add`, then
enable it in `metrics.enabled` like any built-in evaluator.

**Example custom evaluator definition** (created by the interactive wizard
and stored locally):

```json
{
  "id": "answer-style",
  "version": "1",
  "name": "Answer Style",
  "description": "Checks whether the answer is concise, direct, and well structured.",
  "prompt": "Evaluate the answer style for this request. User request: {{input}} Answer: {{output}} Return a continuous score from 0.0 to 1.0.",
  "requiredFields": ["input", "output"],
  "scoring": {
    "type": "continuous",
    "range": [0, 1],
    "threshold": 0.7
  }
}
```

Enable it in your eval config:

```yaml
metrics:
  enabled:
    - faithfulness
    - answer-style
```

Useful commands:

```bash
dt-evals evaluators add
dt-evals evaluators list
dt-evals evaluators show answer-style
dt-evals evaluators test answer-style
```

### Drift detection

`drift` compares current score distributions against a 7 day baseline of prior evaluation events.

Use it when you care about regressions that show up gradually, not just single-run threshold breaches.

## TypeScript Library

The repository also includes [`dt-eval-lib`](../dt-eval-lib/README.md) — a standalone TypeScript package for running the same judge-based metrics directly in code, tests, and CI pipelines without the CLI. It supports all six providers and the full built-in evaluator catalog.

## PII Handling

For CLI trace evaluation runs, the following are masked in memory before content is sent to an external judge model:

- email addresses
- phone numbers
- credit card numbers
- social security numbers

The original values are not sent to the judge by the CLI path.

## Data Expectations

The CLI reads OTel GenAI semconv fields by default:

| Canonical field | Default attributes read |
|----------------|------------------------|
| `input` | `gen_ai.input.messages` |
| `output` | `gen_ai.output.message`, `gen_ai.output.messages` |
| `model` | `gen_ai.request.model` |
| `systemInstruction` | `gen_ai.system_instruction` |

This makes the CLI a good fit for apps instrumented with OpenTelemetry
GenAI conventions. For other tracing schemas — including OpenInference —
use `scope.spanFields` to map their attributes to the canonical fields
above. OpenInference commonly uses attributes such as
`llm.input_messages`, `llm.output_messages`, `input.value`,
`output.value`, and `llm.model_name`. A small set of legacy fallback attributes
(`gen_ai.prompt.<n>.content/role`, `gen_ai.completion.0.content`) is also
probed for compatibility with older emitters. See
[`dynatrace-ai-agent-instrumentation-examples`](https://github.com/dynatrace-oss/dynatrace-ai-agent-instrumentation-examples)
for example instrumentations.

## Local Development

```bash
# from the repo root — install all workspace dependencies
npm install

npm run build --workspace=dt-eval-lib
npm run build --workspace=dt-eval-cli
```

Run locally without a build:

```bash
npm run dev -- configure
npm run dev -- run --since 1h --dry-run
```

Run tests:

```bash
npm test
```

## Contributing

Issues and pull requests are welcome.

If you want to work on a larger change, open an issue first so the direction is clear before implementation starts.

## License

[Apache 2.0](LICENSE)
