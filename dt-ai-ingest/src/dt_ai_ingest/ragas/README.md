# Ragas → Dynatrace

Export [Ragas](https://docs.ragas.io/) evaluation scores into Dynatrace as BizEvents.

**Capabilities:** Eval export (aggregate + per-sample scores)

## Install

```bash
pip install dt-ai-ingest[ragas]
```

<details>
<summary>Using <code>uv</code>?</summary>

```bash
uv sync --extra ragas
```

</details>

## Prerequisites

Set your Dynatrace connection (see [main README](../../../README.md#prerequisites) for details):

```bash
export DT_ENDPOINT=https://abc12345.live.dynatrace.com
export DT_ACCESS_TOKEN=dt0c01.****        # needs bizevents.ingest
```

## Usage

Run your Ragas evaluation first, then export the already-computed scores:

```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy
from dt_ai_ingest import DynatraceClient

# 1. Run your evaluation
result = evaluate(dataset, metrics=[faithfulness, answer_relevancy])

# 2. Export to Dynatrace
dt = DynatraceClient()
dt.export(result, dataset_name="my-qa-dataset")
```

One BizEvent per metric (mean score). That's it.

> [!NOTE]
> This exports **already-computed** results. Run your evaluation first, then call `export()`.

### Per-sample mode

For one BizEvent per metric per sample:

```python
dt.export(result, dataset_name="my-qa-dataset", per_sample=True)
```

> [!TIP]
> Ragas metrics use an LLM as judge — you need `OPENAI_API_KEY` (or another provider). See [Ragas docs](https://docs.ragas.io/en/latest/howtos/customizations/customize_models/).

> [!TIP]
> **Jupyter:** If you get an event loop error, add `import nest_asyncio; nest_asyncio.apply()` at the top.

## Verify in Dynatrace

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
       and event.provider == "ragas"
| fields timestamp, gen_ai.evaluation.name,
        gen_ai.evaluation.score.value
| sort timestamp desc
```

## Examples

| File | What it does | API keys? |
|---|---|---|
| [01_mock_evaluation_bizevents.py](../../../examples/ragas/01_mock_evaluation_bizevents.py) | Aggregate + per-sample scores (mock) | No |
| [02_live_evaluation_bizevents.py](../../../examples/ragas/02_live_evaluation_bizevents.py) | LLM-as-judge evaluation (live) | Yes |

```bash
python examples/ragas/01_mock_evaluation_bizevents.py
python examples/ragas/02_live_evaluation_bizevents.py
```

## Tests

```bash
pytest tests/ragas/ -v
```

---

← [Back to main README](../../../README.md)
