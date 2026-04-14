"""Example 1 — Ragas evaluation results → Dynatrace BizEvents.

What this shows
---------------
- Export pre-computed Ragas evaluation scores as ``gen_ai.evaluation.result``
  BizEvents to Dynatrace using the unified ``dt.export()`` API.
- Demonstrates both aggregate mode (default) and per-sample mode.
- Uses mock data — no LLM API keys required.

Gap analysis
------------
What Ragas EvaluationResult provides vs. what DT expects:

  Ragas field                        DT BizEvent field
  ──────────────────────────────────  ──────────────────────────────────────
  metric name (e.g. faithfulness)     gen_ai.evaluation.name
  mean score across samples           gen_ai.evaluation.score.value
  result.run_id                       ragas.run_id  (extra context field)
  user-provided dataset_name          ragas.dataset_name  (extra context)
  user-provided experiment_name       ragas.experiment_name  (extra context)

  One BizEvent per metric (aggregate) or per metric per sample (per_sample=True).

Prerequisites
-------------
    uv sync --extra ragas
    cp .env.example .env   # fill in DT_ENDPOINT and DT_ACCESS_TOKEN

Run
---
    uv run python examples/ragas/01_mock_evaluation_bizevents.py

What to check in Dynatrace
--------------------------
- Grail BizEvents: AI Obs App → Evaluations
- DQL query::

    fetch bizevents
    | filter event.type == "gen_ai.evaluation.result"
           and event.provider == "ragas"
    | fields timestamp, gen_ai.evaluation.name, gen_ai.evaluation.score.value,
             ragas.dataset_name, ragas.experiment_name, ragas.run_id
    | sort timestamp desc
    | limit 20
"""

from __future__ import annotations

import os
import uuid
from types import SimpleNamespace
from pathlib import Path

from dotenv import load_dotenv

from dt_ai_ingest import DynatraceClient

load_dotenv(Path(__file__).with_name(".env"))  # .env next to this script

DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]

# ── 1. Simulate a Ragas EvaluationResult with pre-computed scores ─────────────
#
# In real usage this would be:
#   from ragas import evaluate
#   from ragas.metrics import faithfulness, answer_relevancy, context_precision
#   result = evaluate(dataset, metrics=[faithfulness, answer_relevancy, context_precision])
#
# Here we use a SimpleNamespace to avoid needing an LLM API key.

mock_scores = [
    {"faithfulness": 0.85, "answer_relevancy": 0.92, "context_precision": 0.78},
    {"faithfulness": 0.91, "answer_relevancy": 0.88, "context_precision": 0.95},
    {"faithfulness": 0.72, "answer_relevancy": 0.80, "context_precision": 0.83},
    {"faithfulness": 0.88, "answer_relevancy": 0.94, "context_precision": 0.90},
    {"faithfulness": 0.79, "answer_relevancy": 0.86, "context_precision": 0.71},
]

mock_run_id = uuid.uuid4()

result = SimpleNamespace(scores=mock_scores, run_id=mock_run_id)

# ── 2. Export aggregate scores (default) ──────────────────────────────────────

dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

print("=== Aggregate mode (default) ===")
print(f"Exporting {len(mock_scores)} samples x 3 metrics -> 3 aggregate BizEvents\n")

dt.export(
    result,
    dataset_name="rag-qa-sample",
    experiment_name="ragas-eval-demo",
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)

print(f"Aggregate BizEvents sent (run_id={mock_run_id})\n")

# ── 3. Export per-sample scores (opt-in) ──────────────────────────────────────

print("=== Per-sample mode ===")
print(f"Exporting {len(mock_scores)} samples x 3 metrics -> {len(mock_scores) * 3} BizEvents\n")

# Fresh client needed — asyncio.run() closes its event loop after each call,
# which invalidates the httpx connection pool cached by the previous client.
dt2 = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

dt2.export(
    result,
    dataset_name="rag-qa-sample",
    experiment_name="ragas-eval-demo",
    per_sample=True,
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)

print(f"Per-sample BizEvents sent (run_id={mock_run_id})")
print(
    f'\nDQL: fetch bizevents | filter event.type == "gen_ai.evaluation.result"'
    f' and ragas.run_id == "{mock_run_id}"'
)
