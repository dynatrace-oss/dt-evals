"""Example 2 — Langfuse live scores + OTel tracing → Dynatrace.

What this shows
---------------
- Configure OTel TracerProvider so Langfuse spans flow to Dynatrace via OTLP.
- Instrument a real LLM-powered RAG pipeline using ``langfuse.start_as_current_observation()``
  — **all spans land under ONE trace** visible as a waterfall in DT Distributed Tracing.
- Create evaluation scores in Langfuse after the pipeline run.
- Fetch and export those scores as BizEvents to Dynatrace.
- Requires ``OPENAI_API_KEY`` (and optionally ``OPENAI_BASE_URL`` for proxies).

  .. tip::

     ``langfuse.start_as_current_observation()`` creates OTel spans under the
     hood.  Nested calls automatically share the same ``trace_id``, so the
     whole pipeline shows up as one waterfall in Dynatrace Distributed Tracing.

Prerequisites
-------------
    uv sync --extra langfuse
    pip install openai
    cp .env.example .env   # fill in all values including LANGFUSE_*

Run
---
    uv run python examples/langfuse/02_live_scores_and_tracing.py

What to check in Dynatrace
--------------------------
- Distributed Tracing → search for service "langfuse-eval"
- You should see **one trace per ``rag_pipeline`` call** with a waterfall:
  ``rag_pipeline → retrieve_context → rerank → llm_call → format_answer``
- Grail BizEvents: AI Obs App → Evaluations
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

Key detail: the OTel ``BatchSpanProcessor`` must be flushed explicitly
via ``provider.force_flush()`` — ``langfuse.flush()`` only flushes
Langfuse's own queue and does NOT flush the OTLP exporter.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from langfuse import get_client
from openai import OpenAI

from dt_ai_ingest import DynatraceClient

load_dotenv(Path(__file__).with_name(".env"))

DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL")
MODEL = os.environ.get("LLM_MODEL", "gpt-4o")

# ── 1. Wire up OTel → Dynatrace ─────────────────────────────────────────────
dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

provider = dt.configure_tracing(framework="langfuse", service_name="langfuse-eval")

# ── 2. Set up OpenAI client ─────────────────────────────────────────────────
openai_client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_BASE_URL,
)

# ── 3. Define a RAG pipeline with Langfuse observations ─────────────────────
#
# langfuse.start_as_current_observation() creates OTel spans.  Nested calls
# automatically inherit the parent's trace_id → one waterfall in DT.
#
# Trace tree (one trace_id per rag_pipeline call):
#   rag_pipeline              ← root span
#   ├── retrieve_context      ← child span
#   ├── rerank                ← child span
#   ├── llm_call              ← child span (generation)
#   └── format_answer         ← child span

langfuse = get_client()


def retrieve(query: str) -> list[str]:
    """Simulate a retrieval step (swap with your vector DB in production)."""
    with langfuse.start_as_current_observation(as_type="span", name="retrieve_context") as span:
        docs = [f"doc chunk 1 for '{query}'", f"doc chunk 2 for '{query}'"]
        span.update(output=str(docs))
        return docs


def rerank(query: str, docs: list[str]) -> list[str]:
    """Simulate a reranker step."""
    with langfuse.start_as_current_observation(as_type="span", name="rerank") as span:
        ranked = list(reversed(docs))
        span.update(output=str(ranked))
        return ranked


def llm_call(prompt: str) -> str:
    """Call a real LLM via OpenAI-compatible API."""
    with langfuse.start_as_current_observation(
        as_type="generation", name="llm_call", model=MODEL
    ) as gen:
        gen.update(input=prompt)
        response = openai_client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
        )
        result = response.choices[0].message.content
        gen.update(output=result)
        return result


def format_answer(raw: str) -> str:
    """Post-process the LLM response."""
    with langfuse.start_as_current_observation(as_type="span", name="format_answer") as span:
        result = raw.strip()
        span.update(output=result)
        return result


def rag_pipeline(question: str) -> str:
    """Root span — groups all steps into ONE trace visible in DT waterfall."""
    with langfuse.start_as_current_observation(as_type="span", name="rag_pipeline") as span:
        span.update(input=question)
        docs = retrieve(question)
        ranked = rerank(question, docs)
        prompt = f"Context: {ranked}\n\nQuestion: {question}\n\nAnswer concisely in 1-2 sentences."
        raw = llm_call(prompt)
        answer = format_answer(raw)
        span.update(output=answer)
        return answer


# ── 4. Run the pipeline ─────────────────────────────────────────────────────
print(f"=== Langfuse Live Tracing (model={MODEL}) ===\n")

questions = [
    "What is Dynatrace?",
    "How does AI Observability work?",
]

for q in questions:
    answer = rag_pipeline(q)
    print(f"Q: {q}\nA: {answer}\n")

langfuse.flush()

# Flush the OTel BatchSpanProcessor so spans actually reach Dynatrace
# (langfuse.flush() only flushes Langfuse's own queue).
provider.force_flush()

print("Done — spans exported to Dynatrace OTLP endpoint.")
print("Each question produced one trace with a full waterfall of child spans.")


# ── 5. Create evaluation scores in Langfuse ─────────────────────────────────
#
# The RAG pipeline above creates traces/spans, but NOT evaluation scores.
# Scores must exist in Langfuse before dt.export() can fetch and forward them.
# In production, scores come from evaluators (LLM-as-judge, human review, etc.)
# Here we create simple demo scores via the Langfuse SDK.

# Collect trace IDs from recent traces so we can attach scores to them.
traces = langfuse.api.trace.list(limit=2, order_by="timestamp.desc")
trace_ids = [t.id for t in traces.data]

for tid in trace_ids:
    langfuse.create_score(
        trace_id=tid,
        name="faithfulness",
        value=0.95,
    )
    langfuse.create_score(
        trace_id=tid,
        name="answer_relevancy",
        value=0.88,
    )
langfuse.flush()
print(f"Created demo scores for {len(trace_ids)} traces in Langfuse.")

# Langfuse indexes scores asynchronously — newly created scores may not
# appear in the API for a few seconds.  We export ALL scores (no trace_id
# filter) so that the first run already succeeds using scores from previous
# runs or freshly indexed ones.


# ── 6. Export Langfuse scores to Dynatrace as BizEvents ─────────────────────

dt.export(
    langfuse,
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)

print("Done — scores exported as BizEvents.")
print(
    '\nDQL (spans):     fetch spans | filter service.name == "langfuse-eval"'
    " | sort timestamp desc | limit 50"
)
print(
    'DQL (bizevents): fetch bizevents | filter event.type == "gen_ai.evaluation.result"'
    ' and event.provider == "langfuse" | sort timestamp desc | limit 20'
)
