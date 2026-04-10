# dt-eval-cli

**LLM evaluation for Dynatrace GenAI observability.**

`dt-eval-cli` fetches GenAI traces from your Dynatrace environment, evaluates them using an LLM-as-evaluator (OpenAI or Anthropic), and writes structured evaluation results back as Dynatrace business events — giving you quality metrics directly inside your existing observability stack.

---

## Why this exists

Dynatrace captures GenAI spans (inputs, outputs, latency, token usage) automatically via OpenTelemetry. What it does not do out of the box is tell you whether your LLM responses were actually *good*. `dt-eval-cli` closes that gap:

- No extra infrastructure — runs from your terminal or CI pipeline
- Results land in Dynatrace as business events, queryable via DQL alongside your traces
- PII is masked before anything leaves your environment
- Works with whatever LLM provider you already have access to

---

## Features

- **14 built-in evaluators** — toxicity, faithfulness, hallucination, PII leakage, relevance, factual accuracy, coherence, context relevance, answer completeness, prompt injection, bias, summarization quality, conciseness, JSON correctness
- **Custom evaluators** — add your own domain-specific evaluators backed by the same engine
- **Flexible sampling** — random percentage, latest-N traces, or errors-only
- **CI mode** — structured JSON output, non-zero exit on threshold breach, drop straight into GitHub Actions / Jenkins
- **Scheduled runs** — define cron-based evaluation jobs stored locally, run on demand or as a daemon
- **Evaluation history** — browse, filter, and export past runs as JSON or CSV
- **Interactive setup wizard** — guided first-time configuration with `dt-eval-cli configure`
- **Pre-flight validation** — check config schema, Dynatrace connectivity, and evaluator provider keys before running

---

## Requirements

- Node.js >= 20
- A Dynatrace environment with GenAI span ingestion (OpenTelemetry, `gen_ai.*` semantic conventions)
- An OpenAI or Anthropic API key

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

## Quick start

**1. Configure**

```bash
dt-eval-cli configure
```

This launches an interactive wizard that sets your Dynatrace environment URL, API token, evaluator provider, and default evaluators. Config is saved to `.dt-eval.yaml` in the current directory (project-level) and `~/.dt-eval/config.yaml` (global fallback).

**2. Validate**

```bash
dt-eval-cli validate
```

Runs pre-flight checks on your config schema, Dynatrace API connectivity, and evaluator provider reachability before you run anything.

**3. Run evaluations**

```bash
dt-eval-cli run
```

Fetches GenAI traces from the last hour, runs them through your configured evaluators, and writes evaluation results back to Dynatrace as business events.

---

## Command reference

### `configure`

```
dt-eval-cli configure [options]

Options:
  --env-url <url>      Dynatrace environment URL
  --api-token <token>  Dynatrace API token
  --provider <name>    Evaluator provider: openai | anthropic
  --api-key <key>      Evaluator provider API key
  --model <model>      Evaluator model override
  --since <duration>   Default time window (e.g. 1h, 6h, 24h)
  --show               Print current config (secrets redacted)
  --output <path>      Config file path (default: .dt-eval.yaml)
```

Run with no flags to launch the interactive wizard.

---

### `run`

```
dt-eval-cli run [options]

Options:
  --since <duration>    Time window for trace fetch (default: 1h)
  --sample <percent>    Percentage of traces to evaluate (default: 100)
  --metric <name>       Run a specific evaluator only
  --dry-run             Fetch and show payloads without sending to Dynatrace
  --ci                  JSON stdout + exit 1 on threshold breach
  --concurrency <n>     Parallel evaluation workers (default: 5)
```

**CI example:**

```bash
dt-eval-cli run --since 6h --metric faithfulness --ci
```

Exit code 0 = all scores above threshold. Exit code 1 = at least one breach.

---

### `validate`

```
dt-eval-cli validate
```

Runs four pre-flight checks in sequence:

1. Config schema is valid
2. Dynatrace environment is reachable and API token is accepted
3. Evaluator provider API key is valid
4. All configured evaluator IDs exist in the catalog

---

### `evaluators`

Manage evaluator definitions — browse the built-in catalog or add custom domain-specific evaluators.

```
dt-eval-cli evaluators list            # show all built-in + custom evaluators
dt-eval-cli evaluators show <name>     # print the full evaluator definition
dt-eval-cli evaluators add             # interactive wizard to create a custom evaluator
dt-eval-cli evaluators delete <name>   # delete a custom evaluator
dt-eval-cli evaluators test <name>     # run a single evaluator against sample input
```

Custom evaluators are stored at `~/.dt-eval/custom-prompts.json`.

---

### `runs`

Browse and export past evaluation run history from `~/.dt-eval/runs.json` (last 100 runs).

```
dt-eval-cli runs list
dt-eval-cli runs show <runId>
dt-eval-cli runs export --format json   # or --format csv
dt-eval-cli runs export --output out.csv
```

---

### `schedule`

Manage recurring evaluation runs stored in `~/.dt-eval/schedules.json`.

```
dt-eval-cli schedule add --cron "0 * * * *" --since 1h --name hourly
dt-eval-cli schedule list
dt-eval-cli schedule enable <id>
dt-eval-cli schedule disable <id>
dt-eval-cli schedule run <id>       # trigger immediately
dt-eval-cli schedule delete <id>
```

---

### `status`

```
dt-eval-cli status
```

Prints a summary of the resolved config (environment URL, evaluator provider, enabled evaluators, last evaluation run).

---

## Configuration

Config is resolved in this order (highest precedence first):

| Source | Location |
|--------|----------|
| Environment variables | `DT_ENV_URL`, `DT_API_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Project config | `.dt-eval.yaml` in current directory |
| Global config | `~/.dt-eval/config.yaml` |
| Defaults | Built-in |

**Example `.dt-eval.yaml`:**

```yaml
schemaVersion: 1

dynatrace:
  environmentUrl: https://your-env.live.dynatrace.com
  apiToken: dt0c01.xxxx   # or set DT_API_TOKEN

judge:
  provider: anthropic
  model: claude-sonnet-4-6   # optional override
  timeout: 30000
  maxRetries: 2

scope:
  since: 1h
  sampling:
    strategy: random
    percent: 100

metrics:
  enabled:
    - toxicity
    - faithfulness
    - hallucination
    - relevance

alerts:
  thresholds:
    faithfulness: 0.7
    toxicity: 1.0
```

**Supported sampling strategies:**

| Strategy | Config |
|----------|--------|
| Random percentage | `strategy: random`, `percent: 50` |
| Latest N traces | `strategy: latest`, `count: 200` |
| Errors only | `strategy: errors-only` |

---

## Results in Dynatrace

Evaluation results are written back as Dynatrace business events with the following attributes:

| Attribute | Description |
|-----------|-------------|
| `gen_ai.evaluation.metric` | Evaluator name (e.g. `faithfulness`) |
| `gen_ai.evaluation.score.value` | Numeric score (0–1 or 0–5 depending on scale) |
| `gen_ai.evaluation.score.label` | `pass` or `fail` |
| `gen_ai.evaluation.explanation` | LLM-generated explanation of the score |
| `gen_ai.evaluation.run_id` | Run identifier for grouping |
| `gen_ai.span.trace_id` | Links back to the original trace |

Query them in Dynatrace with DQL:

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation"
| summarize avg(gen_ai.evaluation.score.value), by: gen_ai.evaluation.metric
```

---

## Global flags

```
--verbose    Enable debug-level logging
--json       Structured JSON output (for CI/scripts)
```

---

## PII protection

Before any trace content is sent to an external evaluator provider for evaluation, the following patterns are masked:

- Email addresses
- Phone numbers
- Credit card numbers
- Social Security numbers

Masking is applied in-memory and the original data is never written anywhere.

---

## Built-in evaluators

| Evaluator | What it measures |
|-----------|-----------------|
| `toxicity` | Harmful, offensive, or unsafe content |
| `faithfulness` | Whether the answer is grounded in provided context |
| `hallucination` | Fabricated facts not supported by context |
| `pii-leakage` | PII exposed in the model's response |
| `relevance` | How well the response addresses the question |
| `factual-accuracy` | Factual correctness of claims made |
| `coherence` | Logical consistency and readability |
| `context-relevance` | Whether retrieved context was actually useful |
| `answer-completeness` | Whether the response fully answers the question |
| `prompt-injection` | Attempts to hijack the system prompt |
| `bias` | Demographic or ideological bias in the response |
| `summarization-quality` | Quality of summaries |
| `conciseness` | Unnecessary verbosity |
| `json-correctness` | Whether the output is valid, schema-conforming JSON |

---

## Local development

**Prerequisites:** Node.js >= 20, npm.

The repo contains two packages. `dt-eval-cli` depends on `dt-eval-lib` via a local `file:` reference, so build the library first.

```bash
# 1. Install and build the eval engine
cd dt-eval-lib
npm install
npm run build

# 2. Install and build the CLI
cd ../dt-eval-cli
npm install
npm run build
```

**Running commands without installing globally:**

Use `npm run dev` — it runs the source directly through `tsx` with no build step required:

```bash
npm run dev -- configure
npm run dev -- run --dry-run --since 6h
npm run dev -- validate
```

Or build once and link the binary:

```bash
npm run build
npm link          # registers dt-eval-cli on your PATH from dist/
dt-eval-cli run --dry-run
```

**Tests:**

```bash
npm test                  # run all tests once
npm test -- --watch       # watch mode
npm test -- tests/runner  # single suite
```

**Project structure:**

```
src/
  cli/commands/   # one file per command (configure, run, evaluators, runs, …)
  config/         # YAML config load/save/merge/validation
  dt/             # Dynatrace client, DQL query builder, bizevent writer
  masker/         # PII masking applied before evaluation dispatch
  runner/         # orchestration: sampling, batch concurrency, checkpointing
  ui/             # banner, spinner, table renderer, formatters
  logger/         # picocolors logger, --verbose / --json flags
```

---

## License

Apache-2.0
