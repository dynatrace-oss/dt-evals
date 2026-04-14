"""Example 4 — MLflow live evaluation → Dynatrace BizEvents.

What this shows
---------------
- Run a real LLM-based evaluation using ``mlflow.evaluate()`` with custom
  metrics that call an OpenAI-compatible API.
- Export per-metric results as ``gen_ai.evaluation.result`` BizEvents.
- Requires ``OPENAI_API_KEY`` (and optionally ``OPENAI_BASE_URL`` for proxies).

Prerequisites
-------------
    uv sync --extra mlflow
    pip install openai
    cp .env.example .env   # fill in all values

Run
---
    uv run python examples/mlflow/04_live_evaluation_bizevents.py

What to check in Dynatrace
--------------------------
- Grail BizEvents: AI Obs App → Evaluations
- DQL query::

    fetch bizevents
    | filter event.type == "gen_ai.evaluation.result"
           and event.provider == "mlflow"
    | sort timestamp desc
    | limit 10
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import mlflow
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

from dt_ai_ingest import DynatraceClient

load_dotenv(Path(__file__).with_name(".env"))

DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL")
MODEL = os.environ.get("LLM_MODEL", "gpt-4o")

# ── 1. Set up OpenAI client ──────────────────────────────────────────────────
client = OpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_BASE_URL,
)

# ── 2. Build evaluation dataset ──────────────────────────────────────────────
eval_data = pd.DataFrame(
    {
        "inputs": [
            "What is the capital of France?",
            "Who wrote Hamlet?",
            "What year did WWII end?",
        ],
        "ground_truth": ["Paris", "Shakespeare", "1945"],
    }
)


# ── 3. Generate predictions using real LLM ───────────────────────────────────
def predict(question: str) -> str:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "Answer in one word or short phrase only."},
            {"role": "user", "content": question},
        ],
        max_tokens=20,
    )
    return response.choices[0].message.content.strip()


print(f"=== MLflow Live Evaluation (model={MODEL}) ===\n")
print("Generating predictions...")

predictions = []
for q in eval_data["inputs"]:
    pred = predict(q)
    predictions.append(pred)
    print(f"  Q: {q} → A: {pred}")

eval_data["predictions"] = predictions


# ── 4. Compute metrics ───────────────────────────────────────────────────────
def exact_match(df: pd.DataFrame) -> float:
    scores = (
        df["predictions"].str.strip().str.lower() == df["ground_truth"].str.strip().str.lower()
    ).astype(float)
    return float(scores.mean())


def avg_answer_length(df: pd.DataFrame) -> float:
    return float(df["predictions"].str.len().mean())


# ── 5. Run evaluation inside an MLflow run ────────────────────────────────────
mlflow.set_experiment("dt-aiobs-live-eval-demo")

with mlflow.start_run(run_name="live-eval-demo") as run:
    metrics = {
        "exact_match/mean": exact_match(eval_data),
        "answer_length/mean": avg_answer_length(eval_data),
    }

    mlflow.log_metrics(metrics)
    print(f"\nMLflow metrics: {metrics}")

    # ── 6. Export to Dynatrace ────────────────────────────────────────────────
    dt = DynatraceClient(tenant_url=DT_ENDPOINT, access_token=DT_ACCESS_TOKEN, dry_run=False)

    result = SimpleNamespace(metrics=metrics)

    dt.export(
        result,
        run_id=run.info.run_id,
        experiment="dt-aiobs-live-eval-demo",
        dataset_name="qa-live-3rows",
        eval_type="custom",
        eval_method="llm_as_judge",
        scoring_format="score_0_to_1",
    )

    print(f"\nBizEvents sent to Dynatrace (run_id={run.info.run_id})")
    print(
        f'  DQL: fetch bizevents | filter event.type == "gen_ai.evaluation.result"'
        f' and mlflow.run_id == "{run.info.run_id}"'
    )
