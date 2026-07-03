# DeepEval → Dynatrace

Export [DeepEval](https://docs.confident-ai.com/) test results into Dynatrace as BizEvents.

**Capabilities:** Eval export (per-test-case, per-metric with pass/fail status)

## Install

```bash
pip install dt-ai-ingest[deepeval]
```

<details>
<summary>Using <code>uv</code>?</summary>

```bash
uv sync --extra deepeval
```

</details>

## Prerequisites

Set your Dynatrace connection (see [main README](../../../README.md#prerequisites) for details):

```bash
export DT_ENDPOINT=https://abc12345.live.dynatrace.com
export DT_ACCESS_TOKEN=dt0c01.****        # needs storage:events:write
```

## Usage

Run your DeepEval evaluation first, then export the already-computed results:

```python
from deepeval import evaluate
from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric
from deepeval.test_case import LLMTestCase
from dt_ai_ingest import DynatraceClient

# 1. Run your evaluation
test_cases = [
    LLMTestCase(
        input="What is the capital of France?",
        actual_output="The capital of France is Paris.",
        retrieval_context=["France is a country in Europe. Its capital is Paris."],
    )
]
result = evaluate(test_cases, [AnswerRelevancyMetric(), FaithfulnessMetric()])

# 2. Export to Dynatrace
dt = DynatraceClient()
dt.export(result, test_run_name="my-eval")
```

One BizEvent per metric per test case. That's it.

> [!NOTE]
> This exports **already-computed** test results. Run your evaluation first, then call `export()`.

> [!TIP]
> DeepEval metrics use an LLM as judge — you need `OPENAI_API_KEY` (or another provider). See [DeepEval docs](https://docs.confident-ai.com/docs/metrics-introduction).

> [!TIP]
> **Jupyter:** If you get `RuntimeError: Timeout should be used inside a task`, add `import nest_asyncio; nest_asyncio.apply()` at the top.

## Verify in Dynatrace

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
       and event.provider == "deepeval"
| fields timestamp, gen_ai.evaluation.name,
        gen_ai.evaluation.score.value,
        gen_ai.evaluation.score.label
| sort timestamp desc
```

## Examples

| File | What it does | API keys? |
|---|---|---|
| [01_mock_evaluation_bizevents.py](../../../examples/deepeval/01_mock_evaluation_bizevents.py) | Mock scores → BizEvents | No |
| [02_live_evaluation_bizevents.py](../../../examples/deepeval/02_live_evaluation_bizevents.py) | LLM-as-judge → BizEvents (live) | Yes |

```bash
python examples/deepeval/01_mock_evaluation_bizevents.py
python examples/deepeval/02_live_evaluation_bizevents.py
```

## Tests

```bash
pytest tests/deepeval/ -v
```

---

← [Back to main README](../../../README.md)
