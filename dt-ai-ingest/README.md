<div align="center">

# dt-ai-ingest

**Ship LLM evaluation results into Dynatrace — as BizEvents and OTel traces.**

One import. One client. Two methods.

[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/downloads/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-green.svg)](LICENSE)
[![Tests: 222 passing](https://img.shields.io/badge/tests-222%20passing-brightgreen.svg)](#running-tests)

</div>

---

```python
from dt_ai_ingest import DynatraceClient

dt = DynatraceClient()                                  # reads DT_ENDPOINT + DT_ACCESS_TOKEN from env
dt.export(result)                                        # ship eval scores as BizEvents
dt.configure_tracing(framework="langfuse")               # forward OTel traces to Dynatrace
```

Works with **Ragas**, **DeepEval**, **MLflow**, and **Langfuse** — no OTel or BizEvents knowledge required.

---

<details>
<summary><strong>Table of Contents</strong></summary>

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Supported Frameworks](#supported-frameworks)
- [Usage](#usage)
  - [Export Evaluation Results](#export-evaluation-results-post-hoc)
  - [Configure Tracing](#configure-tracing)
- [Verify in Dynatrace](#verify-in-dynatrace)
- [Examples](#examples)
- [Architecture](#architecture)
- [Running Tests](#running-tests)
- [Contributing](#contributing)
- [License](#license)
- [References](#references)

</details>

---

## Installation

```bash
pip install dt-ai-ingest[all]        # all frameworks
```

Or pick only what you need:

```bash
pip install dt-ai-ingest[ragas]      # Ragas only
pip install dt-ai-ingest[deepeval]   # DeepEval only
pip install dt-ai-ingest[mlflow]     # MLflow only
pip install dt-ai-ingest[langfuse]   # Langfuse only
```

<details>
<summary>Using <code>uv</code>?</summary>

```bash
uv sync --extra all           # or --extra ragas, --extra mlflow, etc.
```

</details>

## Quick Start

**1. Set two env vars:**

```bash
export DT_ENDPOINT="https://abc12345.live.dynatrace.com"
export DT_ACCESS_TOKEN="dt0c01.****"
```

**2. Run your evaluation, then export:**

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy
from dt_ai_ingest import DynatraceClient

result = evaluate(dataset, metrics=[faithfulness, answer_relevancy])

dt = DynatraceClient()
dt.export(result, dataset_name="my-qa-dataset")
# → BizEvents appear in Dynatrace Grail within seconds
```

That's it. `export()` auto-detects the framework. Same pattern for DeepEval, MLflow, and Langfuse.

## Prerequisites

```bash
# Dynatrace connection
export DT_ENDPOINT="https://<your-env-id>.live.dynatrace.com"
export DT_ACCESS_TOKEN="dt0c01.****"
```

Or use a `.env` file (not committed to git):

```bash
DT_ENDPOINT=https://<your-env-id>.live.dynatrace.com
DT_ACCESS_TOKEN=dt0c01.****
```

| Variable | Description | Example |
|---|---|---|
| `DT_ENDPOINT` | Your Dynatrace environment URL | `https://abc12345.live.dynatrace.com` |
| `DT_ACCESS_TOKEN` | A Dynatrace access token (classic `dt0c01.*` or Bearer/OAuth) | `dt0c01.****` |

**Required token scopes:**

| Capability | Token scope |
|---|---|
| Export evaluation results (BizEvents) | `bizevents.ingest` |
| Export OTel traces | `openTelemetryTrace.ingest` |

You can also pass credentials directly to `DynatraceClient()` instead of using environment variables:

```python
dt = DynatraceClient(
    endpoint="https://abc12345.live.dynatrace.com",
    access_token="dt0c01.****",
)
```

> [!NOTE]
> **Classic vs. Platform URL:** Classic tokens (`dt0c01.*`) require classic environment URLs (`https://<env-id>.live.dynatrace.com`). Platform URLs (`https://<env-id>.apps.dynatrace.com`) require OAuth/Bearer tokens. The library auto-detects the correct API path.

## Supported Frameworks

| Framework | Eval Export | Trace Export | Guide |
|---|---|---|---|
| [Ragas](https://docs.ragas.io/) | `dt.export(result)` | — | [Ragas → Dynatrace](src/dt_ai_ingest/ragas/README.md) |
| [DeepEval](https://docs.confident-ai.com/) | `dt.export(result)` | — | [DeepEval → Dynatrace](src/dt_ai_ingest/deepeval/README.md) |
| [MLflow](https://mlflow.org/) | `dt.export(result)` | `dt.configure_tracing(framework="mlflow")` | [MLflow → Dynatrace](src/dt_ai_ingest/mlflow/README.md) |
| [Langfuse](https://langfuse.com/) | `dt.export(langfuse_client)` | `dt.configure_tracing(framework="langfuse")` | [Langfuse → Dynatrace](src/dt_ai_ingest/langfuse/README.md) |

## Usage

The library has two independent capabilities:

| Capability | Method | When | Use case |
|---|---|---|---|
| **Evaluation export** | `dt.export(result)` | **After** your eval finishes | Ship scores to Dynatrace dashboards |
| **Trace export** | `dt.configure_tracing(...)` | **Before** your LLM calls | Observe LLM/RAG execution in distributed traces |

> [!TIP]
> You can use both on the same client — they are independent. Tracing captures execution spans; export ships evaluation scores.

### Export evaluation results (post-hoc)

Run your evaluation first, then export the already-computed results:

```python
from dt_ai_ingest import DynatraceClient

dt = DynatraceClient()
dt.export(result)                                # auto-detects framework
dt.export(result, dataset_name="my-qa-dataset")  # optional metadata
```

<details>
<summary>Framework-specific examples</summary>

**Ragas:**

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy

result = evaluate(dataset, metrics=[faithfulness, answer_relevancy])
dt.export(result, dataset_name="my-qa-dataset")
```

**DeepEval:**

```python
from deepeval import evaluate
from deepeval.metrics import AnswerRelevancyMetric

result = evaluate(test_cases, [AnswerRelevancyMetric()])
dt.export(result, test_run_name="my-eval")
```

**MLflow:**

```python
import mlflow

with mlflow.start_run() as run:
    result = mlflow.evaluate(data=eval_df, model_type="question-answering")
    dt.export(result, run_id=run.info.run_id)
```

**Langfuse:**

```python
from langfuse import Langfuse

langfuse = Langfuse()
dt.export(langfuse, trace_ids=["trace-abc-123"])
```

</details>

### Configure tracing

Call once at startup — all subsequent LLM spans are automatically exported to Dynatrace:

```python
from dt_ai_ingest import DynatraceClient

dt = DynatraceClient()
dt.configure_tracing(framework="mlflow", service_name="my-rag-app")

# All @mlflow.trace spans from here on go to Dynatrace
```

Works with MLflow (`@mlflow.trace`) and Langfuse (`@langfuse.observe()`).

## Verify in Dynatrace

Query your exported scores with DQL:

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
| fields timestamp,
        gen_ai.evaluation.name,
        gen_ai.evaluation.score.value,
        event.provider
| sort timestamp desc
| limit 20
```

## Examples

Every framework has **mock** examples (no API keys needed) and **live** examples (require real credentials).

Copy `.env.example` → `.env` in the example folder and fill in your keys.

| Example | What it does | API keys? |
|---|---|---|
| [ragas/01_mock](examples/ragas/01_mock_evaluation_bizevents.py) | Aggregate + per-sample scores (mock) | No |
| [ragas/02_live](examples/ragas/02_live_evaluation_bizevents.py) | LLM-as-judge evaluation | Yes |
| [deepeval/01_mock](examples/deepeval/01_mock_evaluation_bizevents.py) | Mock scores → BizEvents | No |
| [deepeval/02_live](examples/deepeval/02_live_evaluation_bizevents.py) | LLM-as-judge → BizEvents | Yes |
| [mlflow/01_mock_tracing](examples/mlflow/01_mock_tracing.py) | OTel traces (mock) | No |
| [mlflow/02_live_tracing](examples/mlflow/02_live_tracing.py) | OTel traces (real LLM) | Yes |
| [mlflow/03_mock_eval](examples/mlflow/03_mock_evaluation_bizevents.py) | Eval metrics → BizEvents (mock) | No |
| [mlflow/04_live_eval](examples/mlflow/04_live_evaluation_bizevents.py) | Eval metrics → BizEvents (real) | Yes |
| [langfuse/01_mock](examples/langfuse/01_mock_scores_and_tracing.py) | Scores + tracing (mock) | No |
| [langfuse/02_live](examples/langfuse/02_live_scores_and_tracing.py) | Scores + tracing (live) | Langfuse keys |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for internal design, module map, event schema, and transport details.

```text
┌─────────────────────────────────────────────────────────────┐
│  User Code (Ragas · DeepEval · MLflow · Langfuse)           │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│  Adapter Layer  —  dt_ai_ingest.<framework>              │
│  (auto-detect · normalize · build BizEvent payloads)        │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
┌──────────▼──────────┐          ┌────────────▼──────────────┐
│  BizEvents REST     │          │  OTLP Traces              │
│  /api/v2/bizevents  │          │  /api/v2/otlp/v1/traces   │
│  (eval scores)      │          │  (execution spans)        │
└──────────┬──────────┘          └────────────┬──────────────┘
           │                                  │
┌──────────▼──────────────────────────────────▼──────────────┐
│                   Dynatrace Grail                          │
│             DQL · Dashboards · Alerting                    │
└────────────────────────────────────────────────────────────┘
```

## Running Tests

```bash
uv sync --extra dev --extra all
pytest tests/ -v
```

222 tests covering all adapters, the core client, schema builder, auth, OTel configuration, and the unified API.

## Contributing

Contributions are welcome! To get started:

1. Fork the repo and create a feature branch
2. Install dev dependencies: `uv sync --extra dev --extra all`
3. Run tests: `pytest tests/ -v`
4. Open a pull request

## License

Apache 2.0 — see [LICENSE](LICENSE) for the full text.

## References

- [OTel GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [Dynatrace OTLP Ingest](https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api)
- [Dynatrace BizEvents](https://docs.dynatrace.com/docs/platform/grail/use-cases/analyze-bizevent-data)
- [Ragas Documentation](https://docs.ragas.io/)
- [DeepEval Documentation](https://docs.confident-ai.com/)
- [MLflow Documentation](https://mlflow.org/docs/latest/)
- [Langfuse Documentation](https://langfuse.com/docs)
