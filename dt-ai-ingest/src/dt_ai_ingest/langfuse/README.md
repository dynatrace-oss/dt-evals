# Langfuse → Dynatrace

Export [Langfuse](https://langfuse.com/) evaluation scores and execution traces into Dynatrace.

**Capabilities:** Score export (paginated API, NUMERIC/BOOLEAN/CATEGORICAL) + OTel trace redirect (`@langfuse.observe()`)

## Install

```bash
pip install dt-ai-ingest[langfuse]
```

<details>
<summary>Using <code>uv</code>?</summary>

```bash
uv sync --extra langfuse
```

</details>

## Prerequisites

You need both Dynatrace and Langfuse credentials:

```bash
# Dynatrace (see main README for details)
export DT_ENDPOINT=https://abc12345.live.dynatrace.com
export DT_ACCESS_TOKEN=dt0c01.****        # needs storage:events:write + openTelemetryTrace.ingest

# Langfuse (for score export)
export LANGFUSE_PUBLIC_KEY=pk-lf-****
export LANGFUSE_SECRET_KEY=sk-lf-****
export LANGFUSE_HOST=https://cloud.langfuse.com   # or your self-hosted URL
```

## Usage

### Scores (post-hoc)

Fetch scores that already exist in Langfuse and forward them to Dynatrace as BizEvents:

```python
from langfuse import Langfuse
from dt_ai_ingest import DynatraceClient

langfuse = Langfuse()

dt = DynatraceClient()
dt.export(langfuse, trace_ids=["trace-abc-123"])
```

One BizEvent per score. All three Langfuse score types (NUMERIC, BOOLEAN, CATEGORICAL) are supported.

> [!NOTE]
> This fetches **already-stored** scores from the Langfuse API. Scores must exist in Langfuse before calling `export()`.

### Traces

Langfuse v4+ is OTel-native. Call once **before** your LLM calls to route spans to Dynatrace alongside Langfuse:

```python
from langfuse import Langfuse
from dt_ai_ingest import DynatraceClient

dt = DynatraceClient()
dt.configure_tracing(framework="langfuse", service_name="my-rag-app")

langfuse = Langfuse()

@langfuse.observe()
def my_llm_call(prompt: str) -> str:
    ...  # spans go to both Langfuse AND Dynatrace
```

> [!NOTE]
> This instruments **future** calls only. It does not retroactively export past traces.

## Verify in Dynatrace

**Scores:**

```dql
fetch bizevents
| filter event.type == "gen_ai.evaluation.result"
       and event.provider == "langfuse"
| fields timestamp, gen_ai.evaluation.name,
        gen_ai.evaluation.score.value
| sort timestamp desc
```

**Traces:**

```dql
fetch spans
| filter service.name == "my-rag-app"
| sort timestamp desc
| limit 50
```

## Examples

| File | What it does | API keys? |
|---|---|---|
| [01_mock_scores_and_tracing.py](../../../examples/langfuse/01_mock_scores_and_tracing.py) | Scores + tracing (mock) | No |
| [02_live_scores_and_tracing.py](../../../examples/langfuse/02_live_scores_and_tracing.py) | Scores + tracing (live) | Langfuse keys |

```bash
python examples/langfuse/01_mock_scores_and_tracing.py
python examples/langfuse/02_live_scores_and_tracing.py
```

## Tests

```bash
pytest tests/langfuse/ -v
```

---

← [Back to main README](../../../README.md)
