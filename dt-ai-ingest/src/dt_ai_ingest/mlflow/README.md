# MLflow → Dynatrace

Export [MLflow](https://mlflow.org/) evaluation metrics and execution traces into Dynatrace.

**Capabilities:** Eval export (metrics from `mlflow.evaluate()`) + OTel trace redirect (`@mlflow.trace`)

## Install

```bash
pip install dt-ai-ingest[mlflow]
```

<details>
<summary>Using <code>uv</code>?</summary>

```bash
uv sync --extra mlflow
```

</details>

## Prerequisites

Set your Dynatrace connection (see [main README](../../../README.md#prerequisites) for details):

```bash
export DT_ENDPOINT=https://abc12345.live.dynatrace.com
export DT_ACCESS_TOKEN=dt0c01.****        # needs bizevents.ingest + openTelemetryTrace.ingest
```

## Usage

### Traces

Call once **before** your LLM calls. All `@mlflow.trace` spans created after this point go to Dynatrace automatically.

```python
from dt_ai_ingest import DynatraceClient
import mlflow

dt = DynatraceClient()
dt.configure_tracing(framework="mlflow", service_name="my-rag-app")

@mlflow.trace(span_type="LLM")
def call_llm(prompt: str) -> str:
    ...  # spans go to Dynatrace
```

> [!NOTE]
> This instruments **future** calls only. It does not retroactively export past traces.

### Evaluation metrics (post-hoc)

Run `mlflow.evaluate()` first, then export the results:

```python
from dt_ai_ingest import DynatraceClient
import mlflow

dt = DynatraceClient()

with mlflow.start_run() as run:
    result = mlflow.evaluate(data=eval_df, model_type="question-answering")
    dt.export(result, run_id=run.info.run_id, experiment="my-eval")
```

One BizEvent per metric. That's it.

> [!TIP]
> MLflow's LLM-as-judge metrics need `OPENAI_API_KEY`. Code-based metrics (exact_match, rouge, etc.) don't.

> [!TIP]
> **Jupyter:** If you get an event loop error, add `import nest_asyncio; nest_asyncio.apply()` at the top.

## Verify in Dynatrace

**Traces:**

```dql
fetch spans
| filter service.name == "my-rag-app"
| sort timestamp desc
| limit 50
```

**Evaluation results:**

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
       and event.provider == "mlflow"
| fields timestamp, gen_ai.evaluation.name,
        gen_ai.evaluation.score.value
| sort timestamp desc
```

## Examples

| File | What it does | API keys? |
|---|---|---|
| [01_mock_tracing.py](../../../examples/mlflow/01_mock_tracing.py) | OTel traces (mock) | No |
| [02_live_tracing.py](../../../examples/mlflow/02_live_tracing.py) | OTel traces (real LLM) | Yes |
| [03_mock_evaluation_bizevents.py](../../../examples/mlflow/03_mock_evaluation_bizevents.py) | Eval metrics → BizEvents (mock) | No |
| [04_live_evaluation_bizevents.py](../../../examples/mlflow/04_live_evaluation_bizevents.py) | Eval metrics → BizEvents (real) | Yes |

```bash
python examples/mlflow/01_mock_tracing.py
python examples/mlflow/02_live_tracing.py
python examples/mlflow/03_mock_evaluation_bizevents.py
python examples/mlflow/04_live_evaluation_bizevents.py
```

## Tests

```bash
pytest tests/mlflow/ -v
```

---

← [Back to main README](../../../README.md)
