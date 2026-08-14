"""Convert a Ragas ``EvaluationResult`` into ``Eval`` rows."""

from __future__ import annotations

from typing import Any

from dt_ai_ingest.integrations._base import build_eval_kwargs, nan_to_none
from dt_ai_ingest.schema import Eval

_DEFAULT_MAPPING: dict[str, str] = {
    "user_input": "question",
    "question": "question",
    "response": "answer",
    "answer": "answer",
}


def _metric_names(result: Any, records: list[dict[str, Any]]) -> list[str]:
    scores = getattr(result, "scores", None)
    if scores:
        try:
            return list(scores[0].keys())
        except (IndexError, AttributeError, TypeError):
            pass
    # Fallback: numeric columns only (Ragas input columns are text/lists).
    if not records:
        return []
    return [
        k for k, v in records[0].items() if isinstance(v, (int, float)) and not isinstance(v, bool)
    ]


def _rubric_metrics(metric_names: list[str], records: list[dict[str, Any]]) -> set[str]:
    """Metrics whose score exceeds 1 in any sample -> discrete rubric scale."""
    rubric: set[str] = set()
    for metric in metric_names:
        for record in records:
            v = record.get(metric)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 1:
                rubric.add(metric)
                break
    return rubric


def from_ragas(
    result: Any,
    *,
    run_id: str | None = None,
    mapping: dict[str, str] | None = None,
    defaults: dict[str, Any] | None = None,
) -> list[Eval]:
    """One Eval per (sample, metric); NaN scores skipped.

    Binary metrics (Ragas ``AspectCritic``) also carry a ``pass``/``fail`` label;
    metrics scored above 1 use the ``rubric`` scoring_format.
    """
    records: list[dict[str, Any]] = result.to_pandas().to_dict(orient="records")
    metric_names = _metric_names(result, records)
    binary = set(getattr(result, "binary_columns", None) or [])
    rubric = _rubric_metrics([m for m in metric_names if m not in binary], records)

    combined_mapping = {**_DEFAULT_MAPPING, **(mapping or {})}
    base_defaults = dict(defaults or {})
    if run_id is not None:
        base_defaults.setdefault("run_id", run_id)

    evals: list[Eval] = []
    for record in records:
        sample_inputs = {
            k: v for k, v in record.items() if k in combined_mapping and k not in metric_names
        }
        base_kwargs = build_eval_kwargs(sample_inputs, combined_mapping, base_defaults)
        for metric in metric_names:
            score = nan_to_none(record.get(metric))
            if score is None:
                continue
            kwargs: dict[str, Any] = {**base_kwargs, "name": metric, "score": float(score)}
            if metric in binary:
                kwargs["label"] = "pass" if score >= 0.5 else "fail"
            elif metric in rubric:
                kwargs["scoring_format"] = "rubric"
            evals.append(Eval(**kwargs))
    return evals
