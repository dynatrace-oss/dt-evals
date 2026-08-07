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

# Parquet support (pyarrow):
pip install dt-ai-ingest[parquet]
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
    "faithfulness",
    score=0.92,
    label="pass",
    question="What is the capital of France?",
    answer="Paris.",
    model="gpt-4o",
    span_id="a1b2c3d4e5f60718",  # optional — omit to send standalone, or pass span=<otel span>
)
```

## Ingesting from files

`ingest_file()` reads `.csv`, `.jsonl`, `.json`, or `.parquet` and ships each row as a BizEvent.
Every call stamps a shared `dataset_id` on all rows so you can `group by dt.eval.dataset_id` in DQL.
Pass `dataset_id=` explicitly for a stable label; omit it to get an auto-generated UUID.

**CSV** — column names that match `Eval` fields need no `mapping=`:

```csv
name,score,label,scoring_format,explanation,question,answer,model,model_provider,trace_id,span_id,run_id
faithfulness,0.92,pass,score_0_to_1,grounded in context,What is the capital of France?,Paris.,gpt-4o,openai,4bf92f3577b34da6a,00f067aa0ba902b7,run-42
toxicity,0.0,pass,score_0_to_1,no harmful content,What is the capital of France?,Paris.,gpt-4o,openai,4bf92f3577b34da6a,00f067aa0ba902b7,run-42
helpfulness,4,pass,score_1_to_5,thorough and on-topic,How do I reset my password?,Open Settings > Security > Reset.,gpt-4o,openai,7c8d9e0f1a2b3c4d,a1b2c3d4e5f60718,run-42
```

```python
await dt_ai_ingest.ingest_file("scores.csv", dataset_id="golden-set-v1")

# Non-standard column names? Use mapping= to rename them onto Eval fields.
await dt_ai_ingest.ingest_file(
    "scores.csv",
    mapping={"metric": "name", "rating": "score"},
    dataset_id="golden-set-v1",
)
```

**JSONL** — one JSON object per line, same field names:

```jsonl
{"name": "faithfulness", "score": 0.87, "label": "pass", "scoring_format": "score_0_to_1", "explanation": "grounded", "question": "What are the main benefits of observability?", "answer": "Observability helps you understand system behaviour from its outputs.", "model": "claude-sonnet-5", "model_provider": "anthropic", "trace_id": "a1b2c3d4e5f67890", "span_id": "b2c3d4e5f6789001", "run_id": "run-01"}
{"name": "helpfulness", "score": 4, "label": "pass", "scoring_format": "score_1_to_5", "explanation": "clear, could use examples", "question": "What are the main benefits of observability?", "answer": "Observability helps you understand system behaviour from its outputs.", "model": "claude-sonnet-5", "model_provider": "anthropic", "trace_id": "a1b2c3d4e5f67890", "span_id": "b2c3d4e5f6789001", "run_id": "run-01"}
```

```python
await dt_ai_ingest.ingest_file("scores.jsonl", dataset_id="golden-set-v1")
```

**Parquet** — requires `pip install dt-ai-ingest[parquet]`. Column names follow the same conventions; nulls are dropped naturally:

```python
await dt_ai_ingest.ingest_file("scores.parquet", dataset_id="golden-set-v1")
```

Parquet preserves native types (`float64`, `int64`) so there is no string coercion step.
Row groups are streamed — large files are handled without loading everything into memory.

**Query by dataset in DQL:**

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
| filter dt.eval.dataset_id == "golden-set-v1"
| fields timestamp, gen_ai.evaluation.name, gen_ai.evaluation.score.value, gen_ai.evaluation.score.label
```

## More ways to send

```python
from dt_ai_ingest import DynatraceClient, Eval

# A batch (Eval objects or plain dicts).
await dt_ai_ingest.ingest([
    Eval(name="faithfulness", score=0.92, label="pass", explanation="grounded"),
    {"name": "toxicity", "score": 0.0, "label": "pass"},
])

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

| Field | BizEvent key | Meaning |
| ----- | ------------ | ------- |
| `name` | `gen_ai.evaluation.name` | Metric name, e.g. `faithfulness`. **Required.** |
| `score` | `gen_ai.evaluation.score.value` | Numeric score. |
| `label` | `gen_ai.evaluation.score.label` | Categorical outcome, e.g. `pass` / `fail`. |
| `scoring_format` | `gen_ai.evaluation.scoring_format` | `score_0_to_1` (default) or `score_1_to_5`. |
| `explanation` | `gen_ai.evaluation.explanation` | Why the score was given. |
| `method` | `gen_ai.evaluation.method` | How the score was produced, e.g. `llm_as_judge`, `regex`. |
| `question`, `answer`, `system_prompt` | `gen_ai.evaluation.input.*` | The turn being scored. |
| `model`, `model_provider` | `gen_ai.request.model`, `gen_ai.provider.name` | The evaluator (judge) model and provider, e.g. `gpt-4o` / `openai`. Omit for non-LLM scorers. |
| `service_name` | `dt.service.name` | Service the span belongs to. |
| `trace_id`, `span_id` | `trace_id`, `span_id` | Span linkage. |
| `run_id` | `dt.eval.run_id` | Eval run / experiment identifier. |
| `dataset_id` | `dt.eval.dataset_id` | Batch identifier for this file upload. Auto-generated by `ingest_file()` if not supplied — use to `group by dt.eval.dataset_id` in DQL. |
| `span_start`, `span_end` | `span.start_time`, `span.end_time` | Span timing. |

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
