"""Example — DeepEval live tracing → Dynatrace spans.

What this shows
---------------
- Run live OpenAI calls through DeepEval's patched ``AsyncOpenAI`` client.
- Each call becomes an LLM span; attached metrics (AnswerRelevancy) score it.
- Export the spans to Dynatrace via OTel (``configure_tracing``).

Prerequisites
-------------
    uv sync --extra deepeval
    cp .env.example .env   # fill in all values

    DT_ENDPOINT must be the environment URL, e.g.
    ``https://<env-id>.live.dynatrace.com`` (a ``.apps.`` platform URL is
    auto-normalised to ``.live.`` for OTLP ingest).

    DT_ACCESS_TOKEN needs the **openpipeline:traces:ingest** scope — without it
    the OTLP export is rejected with HTTP 403 and no spans appear.

Run
---
    uv run python examples/deepeval/04_live_tracing.py

What to check in Dynatrace
--------------------------
- Distributed Traces app → filter service ``deepeval-eval``.
- Each Golden produces one trace with a nested LLM span.
- DQL::

    fetch spans
    | filter service.name == "deepeval-eval"
    | sort timestamp desc
    | limit 50
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))  # .env next to this script

# ── 0. Configure LLM judge ───────────────────────────────────────────────────
# Must be set BEFORE importing deepeval (reads env vars at import time).

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL")  # optional, for proxies
DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]
MODEL = os.environ.get("DEEPEVAL_MODEL", "gpt-5-mini")

import asyncio
from deepeval.openai import AsyncOpenAI
from deepeval.dataset import EvaluationDataset, Golden
from deepeval.tracing import trace, LlmSpanContext
from deepeval.evaluate.configs import AsyncConfig
from deepeval.metrics import AnswerRelevancyMetric
from dt_ai_ingest import DynatraceClient

# ── 1. Wire up OTel → Dynatrace ──────────────────────────────────────────────
dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

# Keep the provider so we can force_flush() at the end — the plain-OTel path
# uses a BatchSpanProcessor and registers no atexit handler, so buffered spans
# would otherwise be lost when the script exits.
provider = dt.configure_tracing(framework="deepeval", service_name="deepeval-eval")

dataset = EvaluationDataset(
    goldens=[Golden(input="Why is the sky blue?")]
)

# ── 2. Run traced OpenAI calls ────────────────────────────────────────────────

print(f"=== DeepEval Live Tracing (model={MODEL}) ===")

client = AsyncOpenAI()

async def call_openai(prompt: str):
    with trace(llm_span_context=LlmSpanContext(metrics=[AnswerRelevancyMetric(model=MODEL)])):
        return await client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
        )

for golden in dataset.evals_iterator(async_config=AsyncConfig(run_async=True)):
    task = asyncio.create_task(call_openai(golden.input))
    dataset.evaluate(task)

# ── 3. Flush spans to Dynatrace ────────────────────────────────────────────────

num_traces = len(dataset.goldens)
print(f"\nFlushing {num_traces} trace(s) to Dynatrace...")
provider.force_flush()

print("Done!")
print(f'\nDQL: fetch spans | filter service.name ~ "deepeval"')