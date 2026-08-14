"""Convert a DeepEval ``EvaluationResult`` into ``Eval`` rows."""

from __future__ import annotations

from typing import Any

from dt_ai_ingest.integrations._base import build_eval_kwargs, nan_to_none
from dt_ai_ingest.schema import Eval

_DEFAULT_MAPPING: dict[str, str] = {
    "input": "question",
    "actual_output": "answer",
}

# TestResult text fields eligible for mapping onto Eval fields or extra.
_SAMPLE_FIELDS = (
    "input",
    "actual_output",
    "expected_output",
    "context",
    "retrieval_context",
)


def from_deepeval(
    result: Any,
    *,
    run_id: str | None = None,
    mapping: dict[str, str] | None = None,
    defaults: dict[str, Any] | None = None,
) -> list[Eval]:
    """One Eval per (test case, metric); metrics without a score are skipped.

    DeepEval scores are normalised to 0..1, and every metric carries a
    threshold-based ``success`` flag emitted as a ``pass``/``fail`` label.
    """
    combined_mapping = {**_DEFAULT_MAPPING, **(mapping or {})}
    base_defaults = dict(defaults or {})
    run = run_id if run_id is not None else getattr(result, "test_run_id", None)
    if run is not None:
        base_defaults.setdefault("run_id", run)

    evals: list[Eval] = []
    for test_result in getattr(result, "test_results", None) or []:
        sample = {
            field: getattr(test_result, field, None)
            for field in _SAMPLE_FIELDS
            if field in combined_mapping
        }
        base_kwargs = build_eval_kwargs(sample, combined_mapping, base_defaults)
        for metric in getattr(test_result, "metrics_data", None) or []:
            score = nan_to_none(getattr(metric, "score", None))
            if score is None:
                continue
            kwargs: dict[str, Any] = {**base_kwargs, "name": metric.name, "score": float(score)}
            success = getattr(metric, "success", None)
            if success is not None:
                kwargs["label"] = "pass" if success else "fail"
            reason = getattr(metric, "reason", None)
            if reason is not None:
                kwargs["explanation"] = reason
            model = getattr(metric, "evaluation_model", None)
            if model is not None:
                kwargs["model"] = model
            evals.append(Eval(**kwargs))
    return evals
