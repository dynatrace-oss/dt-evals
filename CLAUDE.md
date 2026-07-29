# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Packages

This is a monorepo with four packages:

| Directory | Package | Language | Description |
|-----------|---------|----------|-------------|
| `dt-eval-cli/` | `@dynatrace-oss/dt-evals` | TypeScript | CLI — configure, run, schedule, inspect evals |
| `dt-eval-lib/` | `@dynatrace-oss/dt-eval-lib` | TypeScript | Core library — LLM-as-a-judge evaluation engine |
| `dt-eval-deploy/` | `dt-eval-engine` | TypeScript | Serverless runner (Lambda / Cloud Run / Azure Functions) |
| `dt-ai-ingest/` | `dt-ai-ingest` | Python | Ingest eval results from Ragas/DeepEval/MLflow/Langfuse into Dynatrace |

## Commands

### TypeScript packages (dt-eval-cli, dt-eval-lib, dt-eval-deploy)

There is no root `package.json` / npm workspace — each package has its own dependencies and must be installed separately.

```bash
# Install dependencies (run inside each package directory)
cd dt-eval-cli && npm install
cd dt-eval-lib && npm install
cd dt-eval-deploy && npm install

# Run tests for a package
cd dt-eval-cli && npm test
cd dt-eval-lib && npm test
cd dt-eval-deploy && npm test

# Run a single test file
cd dt-eval-cli && npx vitest run tests/runner/index.test.ts

# Run the CLI locally without building
cd dt-eval-cli && npm run dev -- run --since 1h --dry-run
cd dt-eval-cli && npm run dev -- configure

# Build a package
cd dt-eval-lib && npm run build
cd dt-eval-cli && npm run build
cd dt-eval-deploy && npm run build

# Lint (dt-eval-lib only uses Biome)
cd dt-eval-lib && npm run lint
cd dt-eval-lib && npm run lint:fix

# Markdown lint (requires Docker)
make markdownlint
make markdownlint-fix
```

`dt-eval-lib` is the only package with a lint script; `dt-eval-cli` and `dt-eval-deploy` don't run Biome/ESLint. CI (`.github/workflows/ci-*.yml`) runs each package's install/test/build independently, scoped by path filters, so a change to one package doesn't trigger the others' CI (except `dt-eval-deploy`, which also runs on `dt-eval-lib` changes since it depends on it).

### Python package (dt-ai-ingest)

```bash
cd dt-ai-ingest
uv sync --extra all       # install with all framework extras
uv run pytest             # run all tests
uv run pytest tests/test_client.py  # run a single test file
uv run ruff check src/    # lint
uv run mypy src/          # type check
```

## Architecture

### Data flow for `dt-evals run`

1. **Fetch** — DQL query fetches `gen_ai.*` OTel spans from Dynatrace Grail (`dt-eval-cli/src/dt/dql.ts`)
2. **Sample** — applies random/latest/errors-only sampling strategy (`runner/sampler.ts`)
3. **Mask** — in-memory PII redaction of span fields using regex patterns (`masker/index.ts`)
4. **Evaluate** — calls `dt-eval-lib`'s `evaluate()` for each span×metric pair in parallel batches (`runner/batch.ts`)
5. **Write** — pushes results as `gen_ai.evaluation.result` bizevents back to Dynatrace (`dt/bizevent.ts`)
6. **Drift** — optional population-level drift detection using Cohen's d effect size (`runner/drift.ts`, `dt-eval-lib/src/drift.ts`)

### dt-eval-lib internals

The library's `evaluate(metric, input, config)` function (`engine/evaluate.ts`) is the core:
- Resolves the metric to a `PromptDefinition` from the built-in catalog (`prompts/catalog-data.ts`) or a custom store
- Renders the prompt template — substitutes `{{input}}`, `{{output}}`, `{{context}}`, `{{expectedOutput}}` placeholders (uses function replacement to avoid JS `$$` backreference bugs)
- Calls the provider (OpenAI / Anthropic / Google Gemini / Vertex / Bedrock / Azure OpenAI) via a unified interface in `engine/providers/`
- Parses the JSON response and computes a `Score` with `value` (float) and `label` (`pass`/`fail`) via `scoring/compute.ts`
- Retries on transient HTTP 429 / 5xx errors with exponential backoff

### Provider abstraction

Each provider in `dt-eval-lib/src/engine/providers/` implements a `call(prompt): Promise<LLMJudgeResponse>` interface. Providers are selected via `createProvider(opts)`. The LLM is expected to return a JSON object with `scoreValue`, `summary`, and `reasoning` fields.

### Scoring scales

Three scale types (defined in `scoring/types.ts`): `continuous` (0–1 float), `binary` (0 or 1), and `likert` (discrete integers). Each has a `threshold` that determines pass/fail.

### Config resolution order

`env vars → project .dt-eval.yaml → global ~/.dt-eval/config.yaml → built-in defaults`

Cross-tenant config: `dynatrace.origin` for reading spans (DQL), `dynatrace.destination` for writing bizevents/metrics.

### Custom evaluators

Stored via `PromptStore` interface. CLI uses `~/.dt-eval/prompts.json` as the backing store (`dt-eval-cli/src/prompts/fs-store.ts`). Library consumers register a store via `registerPromptStore()`.

### Prompt templates

All built-in evaluator prompts are embedded at build time in `dt-eval-lib/src/prompts/catalog-data.ts`. They use strict JSON output format instructions. Placeholders: `{{input}}`, `{{output}}`, `{{context}}`, `{{expectedOutput}}`.

## Key conventions

- All three TypeScript packages use `tsup` to build to `dist/`, ESM output only (`"type": "module"`)
- Tests use `vitest`; `dt-eval-lib` also uses `@biomejs/biome` for lint/format
- The CLI uses `commander` for argument parsing and `@inquirer/prompts` for interactive wizards
- Run history is persisted to `~/.dt-eval/runs.json` via `runner/checkpoint.ts`
- The `schemaVersion` field in `.dt-eval.yaml` is currently `2`
- `dt-eval-cli` and `dt-eval-deploy` depend on published `@dynatrace-oss/dt-eval-lib` versions from npm (there is no workspace linking them) — after changing `dt-eval-lib`, bump/publish it (or `npm link`) before the dependent packages will pick up the change
- `dt-eval-deploy` wraps the same CLI to run as a scheduled AWS Lambda / Cloud Run / Azure Functions handler or Docker container (`src/index.ts`); it's triggered by `dt-evals deploy` / `dt-evals schedule` rather than run interactively
