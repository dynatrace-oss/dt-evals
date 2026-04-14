"""Example 2 — Ragas live evaluation → Dynatrace BizEvents.

What this shows
---------------
- Run a live Ragas evaluation with LLM-as-judge metrics
  (faithfulness + answer_relevancy).
- Export results as ``gen_ai.evaluation.result`` BizEvents to Dynatrace.
- Demonstrates both aggregate mode (default) and per-sample mode.
- Requires ``OPENAI_API_KEY`` (and optionally ``OPENAI_BASE_URL`` for proxies).

Prerequisites
-------------
    uv sync --extra ragas
    cp .env.example .env   # fill in all values

Run
---
    uv run python examples/ragas/02_live_evaluation_bizevents.py

What to check in Dynatrace
--------------------------
- Grail BizEvents: AI Obs App → Evaluations
- DQL query::

    fetch bizevents
    | filter event.type == "gen_ai.evaluation.result"
           and event.provider == "ragas"
    | sort timestamp desc
    | limit 20
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL")
DT_ENDPOINT = os.environ["DT_ENDPOINT"]
DT_ACCESS_TOKEN = os.environ["DT_ACCESS_TOKEN"]
MODEL = os.environ.get("LLM_MODEL", "gpt-4o")

from ragas import EvaluationDataset, SingleTurnSample, evaluate  # noqa: E402
from ragas.llms import LangchainLLMWrapper  # noqa: E402
from ragas.metrics import Faithfulness, ResponseRelevancy  # noqa: E402

from dt_ai_ingest import DynatraceClient  # noqa: E402

# ── 1. Configure LLM for Ragas ───────────────────────────────────────────────

from langchain_openai import ChatOpenAI  # noqa: E402

llm_kwargs = {"model": MODEL, "api_key": OPENAI_API_KEY}
if OPENAI_BASE_URL:
    llm_kwargs["base_url"] = OPENAI_BASE_URL

evaluator_llm = LangchainLLMWrapper(ChatOpenAI(**llm_kwargs))

# ── 2. Build evaluation dataset ──────────────────────────────────────────────

samples = [
    SingleTurnSample(
        user_input="What is the capital of France?",
        response="The capital of France is Paris.",
        retrieved_contexts=["France is a country in Western Europe. Its capital city is Paris."],
    ),
    SingleTurnSample(
        user_input="Explain quantum computing in one sentence.",
        response="Quantum computing uses qubits to perform computations exponentially faster than classical computers for certain problems.",
        retrieved_contexts=[
            "Quantum computing is a type of computation that uses quantum bits (qubits) "
            "instead of classical bits. It can solve certain problems exponentially faster."
        ],
    ),
    SingleTurnSample(
        user_input="What is the speed of light?",
        response="The speed of light is approximately 300,000 km/s in a vacuum.",
        retrieved_contexts=["Light travels at approximately 299,792 km/s in a vacuum."],
    ),
]

dataset = EvaluationDataset(samples=samples)

# ── 3. Run Ragas evaluation ──────────────────────────────────────────────────

metrics = [Faithfulness(llm=evaluator_llm), ResponseRelevancy(llm=evaluator_llm)]

print(f"=== Ragas Live Evaluation (model={MODEL}) ===")
print(f"Running {len(samples)} samples × {len(metrics)} metrics...\n")

result = evaluate(dataset=dataset, metrics=metrics)

print("Scores per sample:")
df = result.to_pandas()
print(df.to_string(index=False))
print()

# ── 4. Export aggregate scores ────────────────────────────────────────────────

dt = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

print("=== Aggregate mode ===")
dt.export(
    result,
    dataset_name="rag-qa-live",
    experiment_name="ragas-live-demo",
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)
print("Aggregate BizEvents sent!\n")

# ── 5. Export per-sample scores ───────────────────────────────────────────────

# Fresh client needed — asyncio.run() closes its event loop after each call,
# which invalidates the httpx connection pool cached by the previous client.
dt2 = DynatraceClient(
    tenant_url=DT_ENDPOINT,
    access_token=DT_ACCESS_TOKEN,
    dry_run=False,
)

print("=== Per-sample mode ===")
dt2.export(
    result,
    dataset_name="rag-qa-live",
    experiment_name="ragas-live-demo",
    per_sample=True,
    eval_method="llm_as_judge",
    scoring_format="score_0_to_1",
)
print("Per-sample BizEvents sent!")

run_id = getattr(result, "run_id", "unknown")
print(
    f'\nDQL: fetch bizevents | filter event.type == "gen_ai.evaluation.result"'
    f' and ragas.run_id == "{run_id}"'
)
