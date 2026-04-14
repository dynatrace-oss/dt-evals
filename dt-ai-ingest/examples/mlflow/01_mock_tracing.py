"""Example 1 — MLflow OTel tracing → Dynatrace (mock).

What this shows
---------------
- Configure the global OTel TracerProvider to export MLflow spans to DT via OTLP.
- Instrument a RAG pipeline mock with ``@mlflow.trace``.
- **All spans land under ONE trace** visible as a waterfall in DT Distributed
  Tracing.  The key is nesting: the outermost ``@mlflow.trace`` creates the root
  span, and every traced function called inside it becomes a child span sharing
  the same ``trace_id``.

  .. tip::

     Functions decorated with ``@mlflow.trace`` that are called at the **top
     level** (not inside another traced function) each start a **new** trace.
     To group multiple steps into one waterfall, wrap them in a parent function
     that is also decorated with ``@mlflow.trace``.

Prerequisites
-------------
    uv sync --extra mlflow
    cp .env.example .env   # fill in DT_ENDPOINT and DT_ACCESS_TOKEN

Run
---
    uv run python examples/mlflow/01_mock_tracing.py

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
import time
from pathlib import Path

import mlflow
from dotenv import load_dotenv

from dt_ai_ingest import DynatraceClient

load_dotenv(Path(__file__).with_name(".env"))  # .env next to this script

DT_ENDPOINT = os.environ["DT_ENDPOINT"]  # e.g. https://<env-id>.live.dynatrace.com
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]  # DT access token

# ── 1. Wire up OTel → Dynatrace ───────────────────────────────────────────────
dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
)

dt.configure_tracing(framework="mlflow", service_name="mlflow-eval")

# ── 2. Define a RAG pipeline mock with multiple stages ───────────────────────
#
# Every function decorated with @mlflow.trace becomes an OTel span.
# Because they are called INSIDE the parent ``rag_pipeline`` span, they
# automatically inherit the same trace_id and show up as child spans in
# the Dynatrace waterfall view.
#
# Trace tree (one trace_id):
#   rag_pipeline              ← root span
#   ├── retrieve_context      ← child span (RETRIEVER)
#   ├── rerank                ← child span
#   ├── llm_call              ← child span (LLM)
#   └── format_answer         ← child span

mlflow.set_experiment("dt-aiobs-tracing-demo")


@mlflow.trace(span_type="RETRIEVER", name="retrieve_context")
def retrieve(query: str) -> list[str]:
    """Simulate a vector-DB lookup."""
    time.sleep(0.05)  # simulate latency
    return [f"doc chunk 1 for '{query}'", f"doc chunk 2 for '{query}'"]


@mlflow.trace(name="rerank")
def rerank(query: str, docs: list[str]) -> list[str]:
    """Simulate a reranker step."""
    time.sleep(0.02)
    return list(reversed(docs))  # mock: just reverse order


@mlflow.trace(span_type="LLM", name="llm_call")
def fake_llm(prompt: str) -> str:
    """Stand-in for a real LLM call — swap with your openai/bedrock/etc. client."""
    time.sleep(0.1)  # simulate LLM latency
    mlflow.update_current_trace(tags={"llm.model": "gpt-4o-mock"})
    return f"Mocked answer for: {prompt}"


@mlflow.trace(name="format_answer")
def format_answer(raw: str) -> str:
    """Post-process the LLM response."""
    return raw.strip().capitalize()


@mlflow.trace(name="rag_pipeline")
def rag_pipeline(question: str) -> str:
    """Root span — groups all steps into ONE trace visible in DT waterfall."""
    docs = retrieve(question)
    ranked = rerank(question, docs)
    prompt = f"Context: {ranked}\n\nQuestion: {question}"
    raw = fake_llm(prompt)
    return format_answer(raw)


# ── 3. Run the pipeline ──────────────────────────────────────────────────────
# Each rag_pipeline() call produces one complete trace in Dynatrace.
with mlflow.start_run(run_name="tracing-demo"):
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
