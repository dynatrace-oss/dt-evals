"""Example 2 — mlflow.evaluate() → Dynatrace BizEvents.

What this shows
---------------
- Run a batch evaluation with ``mlflow.evaluate()`` using custom metrics that
  **do not need an external LLM** (so this runs fully offline).
- Export per-metric results as ``gen_ai.evaluation.result`` BizEvents to Dynatrace.
- Results surface automatically in the AI Obs App and can trigger workflows.

Gap analysis (documented here as the README instructs)
------------------------------------------------------
What mlflow.evaluate() produces vs. what DT expects:

  MLflow field                     DT BizEvent field
  ──────────────────────────────── ──────────────────────────────────────────
  metric name (e.g. exact_match)   gen_ai.evaluation.name
  metrics["exact_match/mean"]      gen_ai.evaluation.score.value
  run.info.run_id                  mlflow.run_id  (extra context field)
  experiment name                  mlflow.experiment  (extra context field)

  One BizEvent is emitted per metric so each score can be queried and alerted
  on individually.

  Missing from OTel tracing:  Per-row scores, aggregate metrics, dataset info.
  → These need the BizEvents path (this example).

  Missing from mlflow.evaluate() itself: execution spans, latency, token counts.
  → These need the OTel tracing path (example 01).

Prerequisites
-------------
    uv sync --extra mlflow
    cp .env.example .env   # fill in DT_ENDPOINT and DT_ACCESS_TOKEN

Run
---
    uv run python examples/mlflow/02_evaluation_bizbevents.py

What to check in Dynatrace
--------------------------
- Grail BizEvents: AI Obs App → Evaluations (event.type == "gen_ai.evaluation.result")
- DQL query to verify ingest::

    fetch bizevents
    | filter event.type == "gen_ai.evaluation.result"
    | fields timestamp, gen_ai.evaluation.name, gen_ai.evaluation.score.value,
             gen_ai.evaluation.method, mlflow.run_id, mlflow.experiment
    | sort timestamp desc
    | limit 10
"""

from __future__ import annotations

import os
from types import SimpleNamespace

import mlflow
import pandas as pd
from dotenv import load_dotenv
from pathlib import Path

from dt_ai_ingest import DynatraceClient

load_dotenv(Path(__file__).with_name(".env"))  # .env next to this script

DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]  # DT access token

# ── 1. Build a tiny Q&A evaluation dataset ────────────────────────────────────
eval_data = pd.DataFrame(
    {
        "inputs": [
            "What is the capital of France?",
            "Who wrote Hamlet?",
            "What year did WWII end?",
        ],
        "ground_truth": ["Paris", "Shakespeare", "1945"],
        "predictions": ["Paris", "Shakespeare", "1944"],  # one wrong answer
    }
)


# ── 2. Compute lightweight custom metrics (no LLM, no external packages) ──────
def exact_match(df: pd.DataFrame) -> float:
    scores = (
        df["predictions"].str.strip().str.lower() == df["ground_truth"].str.strip().str.lower()
    ).astype(float)
    return float(scores.mean())


def avg_answer_length(df: pd.DataFrame) -> float:
    return float(df["predictions"].str.len().mean())


# ── 3. Run evaluation inside an MLflow run ────────────────────────────────────
mlflow.set_experiment("dt-aiobs-eval-demo")

with mlflow.start_run(run_name="bizbevents-demo") as run:
    metrics = {
        "exact_match/mean": exact_match(eval_data),
        "answer_length/mean": avg_answer_length(eval_data),
    }

    mlflow.log_metrics(metrics)
    print("MLflow metrics:", metrics)

    # ── 4. Export to Dynatrace ─────────────────────────────────────────────────
    dt = DynatraceClient(tenant_url=DT_ENDPOINT, access_token=DT_ACCESS_TOKEN, dry_run=False)

    # Wrap the plain metrics dict in a minimal result-like object so that
    # export() (which reads result.metrics) works unchanged.
    result = SimpleNamespace(metrics=metrics)

    dt.export(
        result,
        run_id=run.info.run_id,
        experiment="dt-aiobs-eval-demo",
        dataset_name="qa-sample-3rows",
        eval_type="custom",
        eval_method="code_based",
        scoring_format="score_0_to_1",
    )

    print(f"\nBizEvents sent to Dynatrace (run_id={run.info.run_id})")
    print(
        f'  Grail query: fetch bizevents | filter event.type == "gen_ai.evaluation.result" and mlflow.run_id == "{run.info.run_id}"'
    )
