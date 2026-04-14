"""Example — DeepEval live evaluation → Dynatrace BizEvents.

What this shows
---------------
- Run a live DeepEval evaluation with LLM-as-judge metrics
  (AnswerRelevancy + Faithfulness).
- Export the results as ``gen_ai.evaluation.result`` BizEvents to Dynatrace.
- Each metric on each test case becomes its own BizEvent with pass/fail status.

Prerequisites
-------------
    uv sync --extra deepeval
    cp .env.example .env   # fill in all values

Run
---
    uv run python examples/deepeval/01_live_evaluation_bizevents.py

What to check in Dynatrace
--------------------------
- Grail BizEvents: AI Obs App → Evaluations
- DQL query::

    fetch bizevents
    | filter event.type == "gen_ai.evaluation.result"
           and event.provider == "deepeval"
    | fields timestamp, gen_ai.evaluation.name, gen_ai.evaluation.score.value,
             gen_ai.evaluation.score.label, deepeval.test_case_name,
             deepeval.metric_threshold, deepeval.test_run_name
    | sort timestamp desc
    | limit 20
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

from deepeval import evaluate  # noqa: E402
from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric  # noqa: E402
from deepeval.test_case import LLMTestCase  # noqa: E402
from dt_ai_ingest import DynatraceClient  # noqa: E402


# ── 1. Define test cases ─────────────────────────────────────────────────────
# FaithfulnessMetric requires retrieval_context.
# AnswerRelevancyMetric requires input + actual_output.

test_cases = [
    LLMTestCase(
        input="What is the capital of France?",
        actual_output="The capital of France is Paris.",
        retrieval_context=["France is a country in Western Europe. Its capital city is Paris."],
    ),
    LLMTestCase(
        input="Explain quantum computing in one sentence.",
        actual_output="Quantum computing uses qubits to perform computations exponentially faster than classical computers for certain problems.",
        retrieval_context=[
            "Quantum computing is a type of computation that uses quantum bits (qubits) "
            "instead of classical bits. It can solve certain problems exponentially faster."
        ],
    ),
]

# ── 2. Run evaluation ────────────────────────────────────────────────────────

metrics = [
    AnswerRelevancyMetric(model=MODEL, threshold=0.5),
    FaithfulnessMetric(model=MODEL, threshold=0.5),
]

print(f"=== DeepEval Live Evaluation (model={MODEL}) ===")
print(f"Running {len(test_cases)} test cases × {len(metrics)} metrics...\n")

result = evaluate(test_cases, metrics)

# ── 3. Print results ─────────────────────────────────────────────────────────

for tr in result.test_results:
    print(f"\nTest: {tr.name} | Success: {tr.success}")
    for m in tr.metrics_data:
        print(f"  {m.name}: score={m.score}, success={m.success}, threshold={m.threshold}")

# ── 4. Export to Dynatrace ────────────────────────────────────────────────────

dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

num_events = sum(len(tr.metrics_data) for tr in result.test_results)
print(f"\nExporting {num_events} BizEvents to Dynatrace...")

dt.export(
    result,
    test_run_name="deepeval-live-demo",
    dataset_name="qa-benchmark",
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)

print("Done!")
print(
    f'\nDQL: fetch bizevents | filter event.type == "gen_ai.evaluation.result"'
    f' and deepeval.test_run_name == "deepeval-live-demo"'
)
