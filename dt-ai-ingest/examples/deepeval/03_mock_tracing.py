"""Example 1 — DeepEval mock evaluation → Dynatrace BizEvents.

What this shows
---------------
- Export pre-computed DeepEval-style results as ``gen_ai.evaluation.result``
  BizEvents to Dynatrace.
- Uses mock data — **no LLM API keys required**.
- Each metric on each test case becomes its own BizEvent with pass/fail status.

Prerequisites
-------------
    uv sync --extra deepeval
    cp .env.example .env   # fill in DT_ENDPOINT and DT_ACCESS_TOKEN

Run
---
    uv run python examples/deepeval/01_mock_evaluation_bizevents.py

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
from types import SimpleNamespace

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

from dt_ai_ingest import DynatraceClient  # noqa: E402

DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]

# ── 1. Build mock DeepEval results ───────────────────────────────────────────
# In real usage this would be:
#   from deepeval import evaluate
#   from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric
#   from deepeval.test_case import LLMTestCase
#   result = evaluate(test_cases, [AnswerRelevancyMetric(), FaithfulnessMetric()])
#
# Here we mock the result to avoid needing an LLM API key.


def make_metric(*, name, score, success, threshold=0.5, evaluation_model="gpt-4o-mock", error=None):
    return SimpleNamespace(
        name=name,
        score=score,
        success=success,
        threshold=threshold,
        evaluation_model=evaluation_model,
        error=error,
    )


def make_test_result(*, name, success, metrics_data, conversational=False):
    return SimpleNamespace(
        name=name,
        success=success,
        conversational=conversational,
        metrics_data=metrics_data,
    )


result = SimpleNamespace(
    test_run_id="mock-run-001",
    test_results=[
        make_test_result(
            name="test_capital_question",
            success=True,
            metrics_data=[
                make_metric(name="Answer Relevancy", score=0.95, success=True),
                make_metric(name="Faithfulness", score=0.88, success=True),
            ],
        ),
        make_test_result(
            name="test_quantum_computing",
            success=True,
            metrics_data=[
                make_metric(name="Answer Relevancy", score=0.82, success=True),
                make_metric(name="Faithfulness", score=0.91, success=True),
            ],
        ),
        make_test_result(
            name="test_wrong_answer",
            success=False,
            metrics_data=[
                make_metric(name="Answer Relevancy", score=0.30, success=False),
                make_metric(name="Faithfulness", score=0.45, success=False),
            ],
        ),
    ],
)

# ── 2. Print mock results ────────────────────────────────────────────────────

print("=== DeepEval Mock Evaluation ===\n")
for tr in result.test_results:
    print(f"Test: {tr.name} | Success: {tr.success}")
    for m in tr.metrics_data:
        status = "PASS" if m.success else "FAIL"
        print(f"  {m.name}: score={m.score}, {status}, threshold={m.threshold}")
    print()

# ── 3. Export to Dynatrace ────────────────────────────────────────────────────

dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

num_events = sum(len(tr.metrics_data) for tr in result.test_results)
print(f"Exporting {num_events} BizEvents to Dynatrace...")

dt.export(
    result,
    test_run_name="deepeval-mock-demo",
    dataset_name="qa-benchmark-mock",
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)

print("Done!")
print(
    f'\nDQL: fetch bizevents | filter event.type == "gen_ai.evaluation.result"'
    f' and deepeval.test_run_name == "deepeval-mock-demo"'
)
