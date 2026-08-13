# dt-ai-ingest

[![Python](https://img.shields.io/badge/python-3.11%2B-blue?style=flat-square)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](../LICENSE)

Minimal Python library for shipping custom LLM evaluation results to Dynatrace as BizEvents.

It is send-only: you bring the score, it ships one `gen_ai.evaluation.result` BizEvent per
evaluation, which renders in the Dynatrace GenAI Observability app. It does not run
evaluations and does not export traces.

## Install

```bash
pip install dt-ai-ingest

# Optional extras:
pip install dt-ai-ingest[parquet]   # Parquet file support (pyarrow)
pip install dt-ai-ingest[ragas]     # Ragas EvaluationResult adapter
pip install dt-ai-ingest[deepeval]  # DeepEval EvaluationResult adapter
```

## Configure

Credentials are read from the environment, or passed to `DynatraceClient`:

| Variable       | Meaning                                            |
| -------------- | -------------------------------------------------- |
| `DT_ENDPOINT`  | Tenant URL, e.g. `https://abc.live.dynatrace.com`  |
| `DT_API_TOKEN` | Dynatrace access token with the `bizevents.ingest` scope |

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
    run_id="golden-set-v1",
    question="What is the capital of France?",
    answer="Paris.",
    model="gpt-4o",
    span_id="a1b2c3d4e5f60718",  # optional — omit to send standalone, or pass span=<otel span>
)
```

## Ingesting from files

`ingest_file()` reads `.csv`, `.jsonl`, `.json`, or `.parquet` and ships each row as a BizEvent.
Every call stamps a shared `run_id` on all rows so you can `group by dt.eval.run_id` in DQL.
Pass `run_id=` explicitly for a stable label; omit it to get an auto-generated UUID.

**CSV** — column names that match `Eval` fields need no `mapping=`:

```csv
name,score,label,scoring_format,explanation,question,answer,model,model_provider,trace_id,span_id,run_id
faithfulness,0.92,pass,score_0_to_1,grounded in context,What is the capital of France?,Paris.,gpt-4o,openai,4bf92f3577b34da6a,00f067aa0ba902b7,run-42
toxicity,0.0,pass,score_0_to_1,no harmful content,What is the capital of France?,Paris.,gpt-4o,openai,4bf92f3577b34da6a,00f067aa0ba902b7,run-42
helpfulness,4,pass,rubric,thorough and on-topic,How do I reset my password?,Open Settings > Security > Reset.,gpt-4o,openai,7c8d9e0f1a2b3c4d,a1b2c3d4e5f60718,run-42
```

```python
await dt_ai_ingest.ingest_file("scores.csv", run_id="golden-set-v1")

# Non-standard column names? Use mapping= to rename them onto Eval fields.
await dt_ai_ingest.ingest_file(
    "scores.csv",
    mapping={"metric": "name", "rating": "score"},
    run_id="golden-set-v1",
)
```

**JSONL** — one JSON object per line, same field names:

```jsonl
{"name": "faithfulness", "score": 0.87, "label": "pass", "scoring_format": "score_0_to_1", "explanation": "grounded", "question": "What are the main benefits of observability?", "answer": "Observability helps you understand system behaviour from its outputs.", "model": "claude-sonnet-5", "model_provider": "anthropic", "trace_id": "a1b2c3d4e5f67890", "span_id": "b2c3d4e5f6789001", "run_id": "run-01"}
{"name": "helpfulness", "score": 4, "label": "pass", "scoring_format": "rubric", "explanation": "clear, could use examples", "question": "What are the main benefits of observability?", "answer": "Observability helps you understand system behaviour from its outputs.", "model": "claude-sonnet-5", "model_provider": "anthropic", "trace_id": "a1b2c3d4e5f67890", "span_id": "b2c3d4e5f6789001", "run_id": "run-01"}
```

```python
await dt_ai_ingest.ingest_file("scores.jsonl", run_id="golden-set-v1")
```

**Parquet** — requires `pip install dt-ai-ingest[parquet]`. Column names follow the same conventions; nulls are dropped naturally:

```python
await dt_ai_ingest.ingest_file("scores.parquet", run_id="golden-set-v1")
```

Parquet preserves native types (`float64`, `int64`) so there is no string coercion step.
Row groups are streamed — large files are handled without loading everything into memory.

**Query by run in DQL:**

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
| filter dt.eval.run_id == "golden-set-v1"
| fields timestamp, gen_ai.evaluation.name, gen_ai.evaluation.score.value, gen_ai.evaluation.score.label
```

## More ways to send

```python
from dt_ai_ingest import DynatraceClient, Eval

# A batch (Eval objects or plain dicts).
await dt_ai_ingest.ingest([
    Eval(name="faithfulness", score=0.92, label="pass", run_id="run-1"),
    Eval(name="toxicity", score=0.0, label="pass", run_id="run-1"),
])

# Inline — collect scores in a block; each links to the active OTel span, flushed on exit.
async with dt_ai_ingest.evaluation(run_id="run-1") as record:
    record("faithfulness", score=0.9)
    record("toxicity", score=0.0, label="pass")

# Reuse a connection instead of the zero-config helpers, and link to a span explicitly.
async with DynatraceClient() as dt:
    await dt.submit("relevance", score=0.8, span=my_span, run_id="run-1")
```

## Evaluation fields

`name` and `score` are required; `label` is optional.
`run_id` is auto-generated per call if not provided, so every event in Grail is always groupable.
Unknown kwargs passed directly to `Eval()` are rejected — use `extra={"custom.key": "value"}` to attach arbitrary keys. When ingesting from files or framework integrations, unrecognised columns are automatically routed to `extra`.

| Field | BizEvent key | Meaning |
| ----- | ------------ | ------- |
| `name` | `gen_ai.evaluation.name` | Metric name, e.g. `faithfulness`. **Required.** |
| `score` | `gen_ai.evaluation.score.value` | Numeric score. **Required.** |
| `label` | `gen_ai.evaluation.score.label` | Categorical outcome, e.g. `pass` / `fail`. Optional. |
| `scoring_format` | `gen_ai.evaluation.scoring_format` | `score_0_to_1` (default) or `rubric` (0–5). |
| `explanation` | `gen_ai.evaluation.explanation` | Why the score was given. |
| `method` | `gen_ai.evaluation.method` | How the score was produced, e.g. `llm_as_judge`, `regex`. |
| `question`, `answer`, `system_prompt` | `gen_ai.evaluation.input.*` | The turn being scored. |
| `model`, `model_provider` | `gen_ai.request.model`, `gen_ai.provider.name` | The evaluator (judge) model and provider, e.g. `gpt-4o` / `openai`. Omit for non-LLM scorers. |
| `service_name` | `dt.service.name` | Service the span belongs to. |
| `trace_id`, `span_id` | `trace_id`, `span_id` + `gen_ai.response.id` | Span linkage. `span_id` is also emitted as `gen_ai.response.id` for trace correlation. |
| `run_id` | `dt.eval.run_id` | Eval run / experiment identifier. Auto-generated UUID per call if not supplied. |
| `span_start`, `span_end` | `span.start_time`, `span.end_time` | Span timing. |

### Custom field mapping

When your source data uses different column names, pass `mapping=` to rename them onto `Eval` fields before ingestion. Anything that still doesn't match a known field lands in `extra`.

```python
# File ingestion
await ingest_file("scores.csv", mapping={"metric": "name", "rating": "score"})
```

### Framework integrations

Adapters convert a third-party eval result into `Eval` rows you can `ingest()`.
Each ships behind its own extra and never imports its source library until you
call it.

**Ragas** — `pip install dt-ai-ingest[ragas]`. `from_ragas` fans a Ragas
`EvaluationResult` out into one `Eval` per `(sample, metric)` pair, mapping
`user_input → question` and `response → answer` by default:

```python
from ragas import evaluate
from dt_ai_ingest import ingest
from dt_ai_ingest.integrations.ragas import from_ragas

result = evaluate(dataset, metrics=[faithfulness, answer_relevancy])

evals = from_ragas(
    result,
    run_id="rag-eval-2025-08",                        # groups this run in Grail
    defaults={"model": "gpt-4o", "model_provider": "openai"},
)
await ingest(evals)
```

Scores map by metric type: continuous metrics use `score_0_to_1`; binary metrics
(`AspectCritic`) also get a `pass`/`fail` label; metrics scored above 1
(`RubricsScore`, `SimpleCriteriaScore`) use the `rubric` format (0–5).

Extra columns (e.g. `retrieved_contexts`) are dropped unless you map them
through — `mapping={"retrieved_contexts": "rag.contexts"}` routes them into
`extra`.

**DeepEval** — `pip install dt-ai-ingest[deepeval]`. `from_deepeval` fans a
DeepEval `EvaluationResult` out into one `Eval` per `(test case, metric)` pair,
mapping `input → question` and `actual_output → answer` by default:

```python
from deepeval import evaluate
from dt_ai_ingest import ingest
from dt_ai_ingest.integrations.deepeval import from_deepeval

result = evaluate(test_cases, metrics=[AnswerRelevancyMetric(), FaithfulnessMetric()])

evals = from_deepeval(
    result,
    run_id="rag-eval-2025-08",                        # groups this run in Grail
    defaults={"model_provider": "openai"},
)
await ingest(evals)
```

DeepEval scores are normalised to `score_0_to_1`, and every metric's
threshold-based `success` flag becomes a `pass`/`fail` label. Each metric's
`reason` and `evaluation_model` are carried onto the `Eval` as `explanation`
and `model`. Extra test-case fields (e.g. `retrieval_context`) are dropped
unless you map them through — `mapping={"retrieval_context": "rag.contexts"}`
routes them into `extra`.

## Development

```bash
uv sync
uv run pytest
uv run ruff check .
uv run mypy src
```
