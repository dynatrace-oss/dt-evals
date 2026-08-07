# dt-ai-ingest

[![Python](https://img.shields.io/badge/python-3.10%2B-blue?style=flat-square)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](../LICENSE)

Minimal Python library for shipping custom LLM evaluation results to Dynatrace as BizEvents.

It is send-only: you bring the score, it ships one `gen_ai.evaluation.result` BizEvent per
evaluation, which renders in the Dynatrace GenAI Observability app. It does not run
evaluations and does not export traces.

## Install

```bash
pip install dt-ai-ingest
```

## Configure

Credentials are read from the environment, or passed to `DynatraceClient`:

| Variable       | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `DT_ENDPOINT`  | Tenant URL, e.g. `https://abc.live.dynatrace.com`  |
| `DT_API_TOKEN` | Dynatrace access token with the `events.ingest` scope |

`DT_TENANT_URL` / `DT_ACCESS_TOKEN` are accepted as fallbacks.

## Quick Usage

Everything is `async`.

```python
import dt_ai_ingest

# Ship one evaluation result (reads DT_ENDPOINT + DT_API_TOKEN from the environment).
await dt_ai_ingest.submit(
    "faithfulness",              # metric name
    score=0.92,
    label="pass",
    question="What is the capital of France?",
    answer="Paris.",
    model="gpt-4o",
    span_id="a1b2c3d4e5f60718",  # optional — links the score to a span (pass span_id/trace_id,
)                                #            or span=<otel span>, or omit to send it standalone

```

## More ways to send

```python
from dt_ai_ingest import DynatraceClient, Eval

# A batch (Eval objects or plain dicts).
await dt_ai_ingest.ingest([
    Eval(name="faithfulness", score=0.92, label="pass", explanation="grounded"),
    {"name": "toxicity", "score": 0.0, "label": "pass"},
])

# From a file (.csv / .jsonl / .json) — map columns onto Eval fields.
await dt_ai_ingest.ingest_file(
    "scores.csv",
    mapping={"metric": "name", "rating": "score"},
    defaults={"provider": "my-scorer"},
)

# Inline — collect scores in a block; each links to the active OTel span, flushed on exit.
async with dt_ai_ingest.evaluation(run_id="run-1") as record:
    record("faithfulness", score=0.9)
    record("toxicity", score=0.0, label="pass")

# Reuse a connection instead of the zero-config helpers, and link to a span explicitly.
async with DynatraceClient() as dt:
    await dt.submit("relevance", score=0.8, span=my_span)
```

## Evaluation fields

`name` is the only required field. `score` is validated against `scoring_format`.
Anything not listed here goes into `extra` and is sent verbatim.

| Field | Meaning |
| ----- | ------- |
| `name` | Metric name, e.g. `faithfulness`. **Required.** |
| `score` | Numeric score. |
| `label` | Categorical outcome, e.g. `pass` / `fail`. |
| `scoring_format` | `score_0_to_1` (default), `score_0_to_5`, `score_0_to_10`, `score_0_to_100`. |
| `explanation`, `method` | Why the score was given; how it was produced. |
| `question`, `answer`, `system_prompt`, `model` | The turn being scored. |
| `trace_id`, `span_id`, `run_id`, `span_start`, `span_end` | Span linkage. |
| `provider` | Source of the score (default `custom`). |

## Roadmap

Everything above works today. Planned, in order:

- **Framework adapters** — convert a Ragas / DeepEval / MLflow / Langfuse result into
  `list[Eval]`, then `ingest()`.
- **Fetch → score → send** — pull existing `gen_ai` spans from a tenant, score them
  offline, send the results back linked by span.
- **OTLP egress** — emit evaluations over OTLP alongside BizEvents.

## Development

```bash
uv sync
uv run pytest
uv run ruff check .
uv run mypy src
```
