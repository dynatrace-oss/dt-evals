# dt-evals

End-to-end LLM evaluation toolkit for Dynatrace AI Observability.

`dt-evals` is the main interface. It pulls live `gen_ai.*` spans from your Dynatrace environment, masks sensitive data in memory, scores real production interactions with an LLM judge, and writes structured evaluation results back to Dynatrace as business events — keeping evals, traces, metrics, alerts, and dashboards in one place.

![dt-evals welcome](assets/dt-evals-welcome.png)

## Packages

| Package | Description |
|---------|-------------|
| [`dt-evals`](dt-eval-cli) | CLI — configure, run, schedule, inspect, and deploy evals |
| [`dt-eval-lib`](dt-eval-lib) | TypeScript library — run judge-based evals in code, tests, and CI |
| [`dt-eval-deploy`](dt-eval-deploy) | Deployment resources — Docker image and serverless runners |

> **Early Development**: This project is in active development. If you encounter any bugs or issues, please [file a GitHub issue](https://github.com/dynatrace-oss/dt-evals/issues/new). Contributions and feedback are welcome!

## Requirements

- Node.js `>=20`
- A Dynatrace environment with GenAI spans (`gen_ai.*` OTEL attributes)
- [`dtctl`](https://docs.dynatrace.com/docs/deliver/dynatrace-cli) installed for first-time setup (OAuth token generation)
- Credentials for your judge provider (OpenAI, Anthropic, Google, AWS Bedrock, or Azure OpenAI)

## Install

```bash
npm install -g @dynatrace-oss/dt-evals
```

Or run without installing:

```bash
npx @dynatrace-oss/dt-evals <command>
```

## Quick Start

```bash
# 1. Run the doctor — authenticates via dtctl (browser OAuth), checks permissions,
#    generates a platform token, and writes it to your .env
dt-evals doctor

# 2. Configure your service and judge provider
dt-evals configure

# 3. Run evals on the last hour of traces
dt-evals run --since 1h --sample 10
```

---

## CLI Reference

### `doctor`

Diagnose your environment end-to-end. Uses `dtctl` for browser-based OAuth, checks all required Dynatrace permissions, generates a scoped platform token, and writes it to your `.env`. Run this once on first setup or whenever something breaks.

```bash
# Full interactive check (recommended for first-time setup)
dt-evals doctor

# Generate a platform token only (skips the full health check)
dt-evals doctor create-token

# Use an existing dtctl context
dt-evals doctor --context my-env
dt-evals doctor create-token --context my-env

# Point at a specific environment URL
dt-evals doctor --env-url https://abc12345.apps.dynatrace.com

# Skip token generation (if you already have DT_API_TOKEN set)
dt-evals doctor --skip-token

# Config, provider, and run history only — no dtctl auth required
dt-evals doctor --skip-auth
```

**What it checks:**

| Section | Checks |
|---------|--------|
| Dependencies | Node.js ≥18, dtctl installed and version |
| Authentication | dtctl context selection or creation, browser OAuth flow |
| Permissions | DQL read, bizevent write, metrics ingest, GenAI span count (last 24h) |
| Platform Token | Creates a scoped API token, writes `DT_API_TOKEN` and `DT_ENV_URL` to `.env` |
| AI Provider | API key presence and provider reachability |
| Config & Runs | Config schema validation, last run status, failure rate over 7 days |

Each section produces a pass/warn/fail result with actionable steps for anything that needs attention.

---

### `configure`

Set up Dynatrace and judge provider credentials. Writes to `.dt-eval.yaml` in the current directory or `~/.dt-eval/config.yaml` globally.

```bash
# Interactive wizard
dt-evals configure

# Non-interactive
dt-evals configure \
  --env-url https://your-env.live.dynatrace.com \
  --api-token "$DT_API_TOKEN" \
  --provider openai \
  --api-key "$OPENAI_API_KEY" \
  --model gpt-4.1

# Show resolved config with secrets redacted
dt-evals configure --show
```

---

### `validate`

Check config schema, Dynatrace connectivity, and judge provider reachability before running.

```bash
dt-evals validate
```

---

### `run`

Evaluate recent GenAI traces from Dynatrace.

```bash
# Run all enabled evaluators over the last 2 hours, 20% sample
dt-evals run --since 2h --sample 20

# Run a single evaluator
dt-evals run --since 6h --metric faithfulness

# Preview what would run — no judge calls, no result writes
dt-evals run --since 1h --sample 5 --dry-run

# CI mode — JSON output, exit 1 on threshold breach
dt-evals run --since 6h --metric relevance --ci

# Parallel workers for faster throughput
dt-evals run --since 2h --sample 20 --concurrency 8 --debug
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--since <duration>` | Trace lookback window, e.g. `1h`, `6h`, `24h` |
| `--sample <percent>` | Override sampling: percentage of traces to evaluate (0–100). When omitted, uses the strategy from your config file (default: random 5%) |
| `--metric <name>` | Run only one evaluator |
| `--dry-run` | Fetch and transform traces, skip judge calls and writes |
| `--ci` | JSON result output and exit code `1` on threshold breach |
| `--concurrency <n>` | Number of parallel evaluation workers |
| `--debug` | Per-step timing logs |
| `--config <path>` | Path to a specific config file |

**GitHub Actions example:**

```yaml
- name: Run LLM eval gate
  run: npx @dynatrace-oss/dt-evals run --since 6h --metric faithfulness --ci
  env:
    DT_ENV_URL: ${{ secrets.DT_ENV_URL }}
    DT_API_TOKEN: ${{ secrets.DT_API_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

---

### `evaluators`

Inspect, test, and manage built-in and custom evaluators.

```bash
# List all available evaluators
dt-evals evaluators list

# Show details for one evaluator (prompt, required fields, scoring scale)
dt-evals evaluators show faithfulness

# Send a test trace through the judge for an evaluator
dt-evals evaluators test relevance

# Add a custom evaluator interactively
dt-evals evaluators add

# Remove a custom evaluator
dt-evals evaluators delete my-custom-eval
```

---

### `runs`

View and export local run history from `~/.dt-eval/runs.json`.

```bash
# List recent runs
dt-evals runs list --limit 20

# Inspect a single run in detail
dt-evals runs show run-2026-04-10T12-00-00-ab12cd34

# Export run history
dt-evals runs export --format csv --output runs.csv
dt-evals runs export --format json --output runs.json
```

---

### `schedule`

Configure recurring evaluation runs stored in `~/.dt-eval/schedules.json`.

```bash
# Create a schedule
dt-evals schedule add --name hourly-rag --cron "0 * * * *" --since 1h --sample 10

# List schedules
dt-evals schedule list

# Trigger a schedule immediately
dt-evals schedule run <schedule-id>

# Pause or resume
dt-evals schedule disable <schedule-id>
dt-evals schedule enable <schedule-id>

# Remove
dt-evals schedule delete <schedule-id>
```

---

### `status`

Show resolved config, connectivity state, and last run summary.

```bash
dt-evals status
```

---

### `deploy`

Package and deploy the eval runner as a serverless function for continuous scheduled evaluation.

```bash
dt-evals deploy --provider aws      # AWS Lambda
dt-evals deploy --provider gcp      # Google Cloud Run
dt-evals deploy --provider azure    # Azure Functions
dt-evals deploy --teardown          # Destroy deployed resources
```

See [`dt-eval-deploy`](dt-eval-deploy) for Docker-based deployment.

---

## Required Dynatrace Permissions

### dt-evals CLI

The platform token (or OAuth scope) used by the CLI needs the following permissions:

| Scope | Required for | Notes |
|-------|-------------|-------|
| `storage:spans:read` | `dt-evals run` | Fetches GenAI OTel spans via DQL (`fetch spans`) |
| `storage:events:read` | `dt-evals run` with drift | Reads historical evaluation results for drift baseline (`fetch bizevents`) |
| `storage:events:write` | `dt-evals run` | Writes evaluation results back as business events |
| `metrics:ingest` | Optional | Writes evaluation metrics to Dynatrace metrics API |

Run `dt-evals doctor create-token` to generate a token with exactly these scopes via OAuth.

**Manually create a token** in Dynatrace → Settings → Access Tokens with the scopes above, then set:

```bash
DT_ENV_URL=https://your-env.apps.dynatrace.com
DT_API_TOKEN=dt0c01.xxxxx
```

### dt-ai-ingest (Python library)

| Scope | Required for |
|-------|-------------|
| `storage:events:write` | Sending evaluation results as business events |
| `openTelemetryTrace.ingest` | Exporting OTel traces from MLflow / Langfuse |

---

## Built-in Evaluators

13 built-in LLM judge evaluators plus statistical drift detection.

| Evaluator | Measures |
|-----------|----------|
| `toxicity` | Harmful, offensive, or unsafe output |
| `faithfulness` | Answer grounded in provided context |
| `hallucination` | Unsupported or fabricated claims |
| `relevance` | Answer addresses the user request |
| `coherence` | Structure, clarity, and logical flow |
| `factual-accuracy` | Accuracy against a reference answer |
| `answer-completeness` | All parts of the request answered |
| `context-relevance` | Retrieval quality for supplied context |
| `pii-leakage` | PII present in the output |
| `prompt-injection` | Injection attempts in the input |
| `bias` | Harmful bias or unfair framing |
| `summarization-quality` | Summary faithfulness, coverage, conciseness |
| `conciseness` | Avoids filler and unnecessary padding |
| `drift` | Score regression against a 7 day baseline |

---

## Supported Providers

| Provider | Default model | Notes |
|----------|--------------|-------|
| `openai` | `gpt-5.4` | `OPENAI_API_KEY` |
| `anthropic` | `claude-sonnet-4-7` | `ANTHROPIC_API_KEY` |
| `vertex` | `gemini-3-pro` | `GOOGLE_API_KEY` |
| `gemini` | `gemini-3.1-flash-live` | `GOOGLE_API_KEY` |
| `bedrock` | `anthropic.claude-opus-4-7` | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| `azure-openai` | user-provided deployment name | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_VERSION` |

Override the model with `--model <id>` or set `judge.model` in config.

---

## Configuration

Config resolves in this order: environment variables → project `.dt-eval.yaml` → global `~/.dt-eval/config.yaml` → built-in defaults.

```yaml
schemaVersion: 1
name: travel-assistant-prod

dynatrace:
  environmentUrl: https://your-env.live.dynatrace.com
  apiToken: dt0c01.xxxxx

judge:
  provider: openai
  model: gpt-4.1
  timeout: 30000
  maxRetries: 2

scope:
  service: travel-assistant
  since: 1h
  # sampling is optional — defaults to random 5% when omitted
  sampling:
    strategy: random
    percent: 10

metrics:
  enabled:
    - faithfulness
    - hallucination
    - relevance
    - drift

alerts:
  thresholds:
    faithfulness: 0.7
    relevance: 0.7
```

**Bedrock example:**

```yaml
judge:
  provider: bedrock
  model: us.anthropic.claude-3-5-haiku-20241022-v1:0
  region: us-east-1
  # or use AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars
  apiKey: <AWS_ACCESS_KEY_ID>
  secretKey: <AWS_SECRET_ACCESS_KEY>
```

**Azure OpenAI example:**

```yaml
judge:
  provider: azure-openai
  model: my-gpt4-deployment
  baseUrl: https://my-resource.openai.azure.com/
  apiVersion: 2025-04-01-preview
  # or use AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_VERSION env vars
```

Key environment variables:

```bash
DT_ENV_URL=https://your-env.live.dynatrace.com
DT_API_TOKEN=dt0c01.xxxxx

JUDGE_PROVIDER=openai
JUDGE_MODEL=gpt-4.1

# OpenAI
OPENAI_API_KEY=sk-...
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
# Google (Vertex / Gemini)
GOOGLE_API_KEY=...
# AWS Bedrock
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com/
AZURE_OPENAI_API_VERSION=2025-04-01-preview
```

---

## Results in Dynatrace

Evaluation results land as business events with `event.type == "gen_ai.evaluation.result"`, correlating to the original trace.

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
| summarize avg_score = avg(gen_ai.evaluation.score.value), by: { gen_ai.evaluation.name }
| sort avg_score asc
```

---

## Development

```bash
# Install all workspace dependencies
npm install

# Test dt-eval-lib
make test-lib

# Build dt-eval-lib
make build-lib

# Build the Go engine
make build-engine

# Lint all Markdown
make markdownlint
```

Run the CLI locally without a build:

```bash
cd dt-eval-cli
npm run dev -- configure
npm run dev -- run --since 1h --dry-run
```

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
