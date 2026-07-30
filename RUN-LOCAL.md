# Running dt-evals locally

Steps to run the evals locally against the `.dt-eval.yaml` config.

This config is wired for a **local Ollama judge** (openai-compatible, `localhost:11434`,
model `llama3.2`) and reads GenAI spans from the `uim8926h` sprint tenant.

## Steps

### 1. Install the CLI's dependencies

No root workspace — install per-package. The CLI pulls `dt-eval-lib` from npm, so you
only need the CLI package:

```bash
cd dt-eval-cli && npm install
```

### 2. Start your local judge (Ollama)

The config points at it:

```bash
ollama serve            # if not already running
ollama pull llama3.2    # model referenced in the config
```
Example Config

```
schemaVersion: 2
name: llm-local
dynatrace:
  environmentUrl: https://{id}.sprint.apps.dynatracelabs.com/
judge:
  provider: openai-compatible
  name: "Ollama "
  baseUrl: http://localhost:11434/v1
  model: llama3.2:latest
  timeout: 120000
  maxRetries: 2
scope:
  service: llama-client
  since: 12h
  sampling:
    strategy: random
    percent: 30
metrics:
  enabled:
    - answer-completeness
    - factual-accuracy
    - hallucination
    - drift

```

### 3. Provide the Dynatrace token

`run` requires a token for fetching spans + writing bizevents (origin + destination).
Easiest is one token via `DT_API_TOKEN`:

```bash
export DT_API_TOKEN=<your-platform-token>
```

If you don't have one, run `npm run dev -- doctor` — it can generate/paste a platform
token via `dtctl` interactively.

### 4. Run it

Since the config isn't the default `.dt-eval.yaml`, pass its path. `npm run dev` runs
from inside `dt-eval-cli/`, so reference the repo-root file with `../`:

```bash
cd dt-eval-cli

# dry run first — fetches + transforms, prints payloads, sends nothing
npm run dev -- run ../.dt-eval.yaml --dry-run

# real run
npm run dev -- run ../.dt-eval.yaml
```

## Useful variants

```bash
# validate the config without running
npm run dev -- validate ../.dt-eval.yaml

# single metric, more logging
npm run dev -- run ../.dt-eval.yaml --metric factual-accuracy --debug

# override the time window / sampling from the config
npm run dev -- run ../.dt-eval.yaml --since 6h --sample 10
```

## Notes

- `npm run dev` uses `tsx` (runs TS directly) — no build needed. To use the global
  `dt-evals` instead, run `npm run build` then `npm link` first.
- `--dry-run` is the safe way to confirm span-fetch + judge calls work before writing
  `gen_ai.evaluation.result` bizevents back to the tenant.
- The `drift` metric needs enough sampled spans to compute a population effect size —
  a low `--sample` may skip it.
