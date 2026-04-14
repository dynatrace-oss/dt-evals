"""Example 1 — Langfuse scores + OTel tracing → Dynatrace (mock).

What this shows
---------------
- Configure OTel TracerProvider so Langfuse spans flow to Dynatrace via OTLP.
- Instrument a RAG pipeline mock with OTel spans through the global
  TracerProvider — **all spans land under ONE trace** visible as a waterfall
  in DT Distributed Tracing.
- Export Langfuse evaluation scores as ``gen_ai.evaluation.result`` BizEvents.
- Demonstrates all three score data types: NUMERIC, BOOLEAN, CATEGORICAL.
- Uses mock data — no Langfuse or LLM API keys required.

  .. tip::

     Langfuse v3+ is OTel-native.  When you call
     ``dt.configure_tracing(framework="langfuse")``, a Dynatrace OTLP exporter
     is added to the global TracerProvider.  Langfuse's own
     ``LangfuseSpanProcessor`` attaches to the same provider, so spans flow
     to **both** Langfuse and Dynatrace simultaneously.

     To get a proper waterfall in DT, nest your traced functions inside a
     root span — every child span inherits the same ``trace_id``.

Gap analysis
------------
What Langfuse Score provides vs. what DT expects:

  Langfuse field                     DT BizEvent field
  ─────────────────────────────────  ──────────────────────────────────────
  score.name                         gen_ai.evaluation.name
  score.value                        gen_ai.evaluation.score.value
  score.string_value (bool/cat)      gen_ai.evaluation.score.label
  score.data_type                    langfuse.data_type  (extra context)
  score.trace_id                     trace_id + langfuse.trace_id
  score.observation_id               span_id + langfuse.observation_id
  score.source                       langfuse.score_source
  score.id                           langfuse.score_id

  One BizEvent per score entry.

Prerequisites
-------------
    uv sync --extra langfuse
    cp .env.example .env   # fill in DT_ENDPOINT and DT_ACCESS_TOKEN

Run
---
    uv run python examples/langfuse/01_mock_scores_and_tracing.py

What to check in Dynatrace
--------------------------
- Distributed Tracing → search for service "langfuse-eval"
- You should see **one trace per ``rag_pipeline`` call** with a waterfall:
  ``rag_pipeline → retrieve_context → rerank → llm_call → format_answer``
- Grail BizEvents: AI Obs App → Evaluations (event.type == "gen_ai.evaluation.result")
- DQL queries::

    fetch spans
    | filter service.name == "langfuse-eval"
    | sort timestamp desc
    | limit 50

    fetch bizevents
    | filter event.type == "gen_ai.evaluation.result"
           and event.provider == "langfuse"
    | sort timestamp desc
    | limit 20
"""

from __future__ import annotations

import os
import time
from enum import Enum
from pathlib import Path
from types import SimpleNamespace

from dotenv import load_dotenv
from opentelemetry import trace

from dt_ai_ingest import DynatraceClient

load_dotenv(Path(__file__).with_name(".env"))  # .env next to this script

DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]


# ── 1. Wire up OTel → Dynatrace ─────────────────────────────────────────────
#
# This adds a Dynatrace OTLP exporter to the global TracerProvider.
# Langfuse v3+ adds its own LangfuseSpanProcessor to the same provider,
# so spans flow to both backends.

dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

provider = dt.configure_tracing(framework="langfuse")
print(f"OTel TracerProvider configured: {provider}\n")

tracer = trace.get_tracer("langfuse-rag-demo")


# ── 2. Define a RAG pipeline mock with OTel spans ───────────────────────────
#
# In real usage you would use @langfuse.observe() or
# langfuse.start_as_current_observation() which create OTel spans under the
# hood.  Here we use the raw OTel API directly since we can't import
# Langfuse without API keys.
#
# Trace tree (one trace_id):
#   rag_pipeline              ← root span
#   ├── retrieve_context      ← child span
#   ├── rerank                ← child span
#   ├── llm_call              ← child span
#   └── format_answer         ← child span


def retrieve(query: str) -> list[str]:
    """Simulate a vector-DB lookup."""
    with tracer.start_as_current_span("retrieve_context"):
        time.sleep(0.05)
        return [f"doc chunk 1 for '{query}'", f"doc chunk 2 for '{query}'"]


def rerank(query: str, docs: list[str]) -> list[str]:
    """Simulate a reranker step."""
    with tracer.start_as_current_span("rerank"):
        time.sleep(0.02)
        return list(reversed(docs))


def fake_llm(prompt: str) -> str:
    """Stand-in for a real LLM call."""
    with tracer.start_as_current_span("llm_call") as span:
        span.set_attribute("gen_ai.request.model", "gpt-4o-mock")
        time.sleep(0.1)
        return f"Mocked answer for: {prompt}"


def format_answer(raw: str) -> str:
    """Post-process the LLM response."""
    with tracer.start_as_current_span("format_answer"):
        return raw.strip().capitalize()


def rag_pipeline(question: str) -> str:
    """Root span — groups all steps into ONE trace visible in DT waterfall."""
    with tracer.start_as_current_span("rag_pipeline"):
        docs = retrieve(question)
        ranked = rerank(question, docs)
        prompt = f"Context: {ranked}\n\nQuestion: {question}"
        raw = fake_llm(prompt)
        return format_answer(raw)


# ── 3. Run the pipeline ─────────────────────────────────────────────────────
# Each rag_pipeline() call produces one complete trace in Dynatrace.

print("=== Running RAG pipeline (mock) ===\n")

questions = [
    "What is Dynatrace?",
    "How does AI Observability work?",
]

for q in questions:
    answer = rag_pipeline(q)
    print(f"Q: {q}\nA: {answer}\n")

print("Spans exported to Dynatrace OTLP endpoint.")
print("Each question produced one trace with a full waterfall of child spans.\n")


# ── 4. Simulate Langfuse scores and export as BizEvents ─────────────────────
#
# In real usage you would:
#   from langfuse import Langfuse
#   langfuse = Langfuse()
#   dt.export(langfuse, ...)
#
# Here we mock the Langfuse client to avoid needing API keys.


class MockScoreSource(str, Enum):
    API = "API"
    EVAL = "EVAL"
    ANNOTATION = "ANNOTATION"


def make_score(
    *,
    id,
    name,
    value,
    data_type="NUMERIC",
    string_value=None,
    source=MockScoreSource.EVAL,
    trace_id=None,
    observation_id=None,
    comment=None,
):
    return SimpleNamespace(
        id=id,
        name=name,
        value=value,
        data_type=data_type,
        string_value=string_value,
        source=source,
        trace_id=trace_id,
        observation_id=observation_id,
        session_id=None,
        config_id=None,
        comment=comment,
    )


mock_scores = [
    # Numeric scores (LLM-as-judge evaluations)
    make_score(id="s1", name="faithfulness", value=0.91, trace_id="trace-001"),
    make_score(
        id="s2", name="relevance", value=0.78, trace_id="trace-001", observation_id="obs-gen-1"
    ),
    make_score(id="s3", name="coherence", value=0.85, trace_id="trace-002"),
    # Boolean score (annotation)
    make_score(
        id="s4",
        name="is_hallucination",
        value=0.0,
        data_type="BOOLEAN",
        string_value="False",
        source=MockScoreSource.ANNOTATION,
        trace_id="trace-001",
        comment="No hallucination detected",
    ),
    # Categorical score (human review)
    make_score(
        id="s5",
        name="quality_tier",
        value=2.0,
        data_type="CATEGORICAL",
        string_value="good",
        source=MockScoreSource.ANNOTATION,
        trace_id="trace-002",
    ),
]


# Mock the Langfuse client API response
def _make_api_response(data):
    return SimpleNamespace(
        data=data,
        meta=SimpleNamespace(page=1, limit=100, total_items=len(data), total_pages=1),
    )


class MockScoreV2:
    def get(self, **kwargs):
        return _make_api_response(mock_scores)


class MockApi:
    score_v_2 = MockScoreV2()


mock_langfuse = SimpleNamespace(api=MockApi())


# ── 5. Export scores to Dynatrace ────────────────────────────────────────────

print(f"=== Exporting {len(mock_scores)} Langfuse scores as BizEvents ===")
print(f"  NUMERIC:     3 scores (faithfulness, relevance, coherence)")
print(f"  BOOLEAN:     1 score  (is_hallucination)")
print(f"  CATEGORICAL: 1 score  (quality_tier)")
print()

dt.export(
    mock_langfuse,
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)

print("BizEvents sent!")
print()
print(
    'DQL (spans):     fetch spans | filter service.name == "langfuse-eval"'
    " | sort timestamp desc | limit 50"
)
print(
    'DQL (bizevents): fetch bizevents | filter event.type == "gen_ai.evaluation.result"'
    ' and event.provider == "langfuse" | sort timestamp desc | limit 20'
)
