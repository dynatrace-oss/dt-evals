"""Example 2 — MLflow live OTel tracing → Dynatrace.

What this shows
---------------
- Configure OTel TracerProvider to export MLflow spans to Dynatrace via OTLP.
- Instrument a real LLM call (OpenAI-compatible API) with ``@mlflow.trace``.
- **All spans land under ONE trace** visible as a waterfall in DT Distributed
  Tracing.  The outermost ``@mlflow.trace`` is the root span; every traced
  function called inside it becomes a child span with the same ``trace_id``.
- Requires ``OPENAI_API_KEY`` (and optionally ``OPENAI_BASE_URL`` for proxies).

Prerequisites
-------------
    uv sync --extra mlflow
    pip install openai
    cp .env.example .env   # fill in all values

Run
---
    uv run python examples/mlflow/02_live_tracing.py

What to check in Dynatrace
--------------------------
- Distributed Tracing → search for service "mlflow-eval"
- You should see **one trace per ``rag_pipeline`` call** with a waterfall:
  ``rag_pipeline → retrieve_context → rerank → llm_call → format_answer``
- DQL query::

    fetch spans
    | filter service.name == "mlflow-eval"
    | sort timestamp desc
    | limit 50
"""

from __future__ import annotations

import os
from pathlib import Path

import mlflow
from dotenv import load_dotenv
from openai import OpenAI

from dt_ai_ingest import DynatraceClient

load_dotenv(Path(__file__).with_name(".env"))

DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL")
MODEL = os.environ.get("LLM_MODEL", "gpt-4o")

# ── 1. Wire up OTel → Dynatrace ──────────────────────────────────────────────
dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
)

dt.configure_tracing(framework="mlflow", service_name="mlflow-eval")

# ── 2. Set up OpenAI client ──────────────────────────────────────────────────
client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_BASE_URL,
)

# ── 3. Define a RAG pipeline with multiple traced stages ─────────────────────
#
# Trace tree (one trace_id per rag_pipeline call):
#   rag_pipeline              ← root span
#   ├── retrieve_context      ← child span (RETRIEVER)
#   ├── rerank                ← child span
#   ├── llm_call              ← child span (LLM) — real OpenAI call
#   └── format_answer         ← child span

mlflow.set_experiment("dt-aiobs-tracing-demo")


@mlflow.trace(span_type="RETRIEVER", name="retrieve_context")
def retrieve(query: str) -> list[str]:
    """Simulate a retrieval step (swap with your vector DB in production)."""
    return [f"doc chunk 1 for '{query}'", f"doc chunk 2 for '{query}'"]


@mlflow.trace(name="rerank")
def rerank(query: str, docs: list[str]) -> list[str]:
    """Simulate a reranker step."""
    return list(reversed(docs))


@mlflow.trace(span_type="LLM", name="llm_call")
def llm_call(prompt: str) -> str:
    """Call a real LLM via OpenAI-compatible API."""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
    )
    return response.choices[0].message.content


@mlflow.trace(name="format_answer")
def format_answer(raw: str) -> str:
    """Post-process the LLM response."""
    return raw.strip()


@mlflow.trace(name="rag_pipeline")
def rag_pipeline(question: str) -> str:
    """Root span — groups all steps into ONE trace visible in DT waterfall."""
    docs = retrieve(question)
    ranked = rerank(question, docs)
    prompt = f"Context: {ranked}\n\nQuestion: {question}\n\nAnswer concisely in 1-2 sentences."
    raw = llm_call(prompt)
    return format_answer(raw)


# ── 4. Run the pipeline ─────────────────────────────────────────────────────
print(f"=== MLflow Live Tracing (model={MODEL}) ===\n")

with mlflow.start_run(run_name="live-tracing-demo"):
    questions = [
        "What is Dynatrace?",
        "How does AI Observability work?",
    ]

    for q in questions:
        answer = rag_pipeline(q)
        print(f"Q: {q}\nA: {answer}\n")

print("Done — spans exported to Dynatrace OTLP endpoint.")
print("Each question produced one trace with a full waterfall of child spans.")
print('\nDQL: fetch spans | filter service.name == "mlflow-eval" | sort timestamp desc | limit 50')
