"""Dynatrace AI Observability eval events — core BizEvent schema.

This module defines the Dynatrace-side contract only. Vendor-specific
mapping logic lives in each adapter's own ``schema.py``.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, model_validator


# ---------------------------------------------------------------------------
# Scoring format → valid score range
# ---------------------------------------------------------------------------

_SCORING_FORMAT_RANGES: dict[str, tuple[float, float]] = {
    "score_0_to_1": (0.0, 1.0),
    "score_0_to_5": (0.0, 5.0),
    "score_0_to_10": (0.0, 10.0),
    "score_0_to_100": (0.0, 100.0),
}


# ---------------------------------------------------------------------------
# Field map: Python kwarg names → BizEvent dot-separated keys
# ---------------------------------------------------------------------------

_EVAL_RESULT_FIELD_MAP: dict[str, str] = {
    "eval_name": "gen_ai.evaluation.name",
    "score_value": "gen_ai.evaluation.score.value",
    "score_label": "gen_ai.evaluation.score.label",
    "eval_type": "gen_ai.evaluation.type",
    "eval_version": "gen_ai.evaluation.version",
    "eval_spec_id": "gen_ai.evaluation.spec_id",
    "scoring_format": "gen_ai.evaluation.scoring_format",
    "explanation": "gen_ai.evaluation.explanation",
    "eval_method": "gen_ai.evaluation.method",
    "trace_id": "trace_id",
    "span_id": "span_id",
    "response_id": "gen_ai.response.id",
    "input_tokens": "gen_ai.usage.input_tokens",
    "output_tokens": "gen_ai.usage.output_tokens",
    "response_model": "gen_ai.response.model",
    "request_model": "gen_ai.request.model",
    "provider_name": "gen_ai.provider.name",
    "event_provider": "event.provider",
    "adapter_name": "event.provider",
}


# ---------------------------------------------------------------------------
# EvalEvent — Pydantic model for a single evaluation result
# ---------------------------------------------------------------------------


class EvalEvent(BaseModel):
    """Dynatrace ``gen_ai.evaluation.result`` BizEvent."""

    event_type: str = "gen_ai.evaluation.result"
    trace_id: str | None = None
    span_id: str | None = None
    response_id: str | None = None
    evaluation_name: str
    evaluation_type: str = "ready_made"
    scoring_format: str
    score_value: float | None = None
    score_label: str | None = None
    explanation: str | None = None
    method: str = "programmatic"
    input_tokens: int | None = None
    output_tokens: int | None = None
    response_model: str | None = None

    @model_validator(mode="after")
    def _validate_score_in_range(self) -> EvalEvent:
        """Raise ``ValidationError`` if score_value is outside the scoring_format range."""
        if self.score_value is None:
            return self
        bounds = _SCORING_FORMAT_RANGES.get(self.scoring_format)
        if bounds is not None:
            lo, hi = bounds
            if not (lo <= self.score_value <= hi):
                msg = (
                    f"score_value {self.score_value} is outside the valid range "
                    f"[{lo}, {hi}] for scoring_format '{self.scoring_format}'"
                )
                raise ValueError(msg)
        return self

    def to_bizevents_payload(self) -> dict[str, Any]:
        """Return the flat JSON dict expected by ``/api/v2/bizevents/ingest``."""
        payload: dict[str, Any] = {
            "event.type": self.event_type,
            "gen_ai.evaluation.name": self.evaluation_name,
            "gen_ai.evaluation.type": self.evaluation_type,
            "gen_ai.evaluation.scoring_format": self.scoring_format,
            "gen_ai.evaluation.method": self.method,
        }
        optional: list[tuple[Any, str]] = [
            (self.trace_id, "trace_id"),
            (self.span_id, "span_id"),
            (self.response_id, "gen_ai.response.id"),
            (self.explanation, "gen_ai.evaluation.explanation"),
            (self.score_value, "gen_ai.evaluation.score.value"),
            (self.score_label, "gen_ai.evaluation.score.label"),
            (self.input_tokens, "gen_ai.usage.input_tokens"),
            (self.output_tokens, "gen_ai.usage.output_tokens"),
            (self.response_model, "gen_ai.response.model"),
        ]
        for v, k in optional:
            if v is not None:
                payload[k] = v
        return payload


# ---------------------------------------------------------------------------
# build_eval_result_event — generic flat dict builder
# ---------------------------------------------------------------------------


def build_eval_result_event(
    *,
    eval_name: str,
    score_value: float | None = None,
    extra: dict[str, Any] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Build a flat BizEvent dict for a single evaluation result.

    One event per metric per evaluated item.  Valid keyword arguments are
    the keys of ``_EVAL_RESULT_FIELD_MAP``.  Unknown keys are ignored.
    Pass ``extra`` for arbitrary framework-specific metadata.

    ``score_value`` is optional: metrics that produce a label but no numeric
    score (e.g. an errored DeepEval metric or a Langfuse categorical score
    without a numeric mapping) still emit a schema-conformant event — the
    ``gen_ai.evaluation.score.value`` key is simply omitted.
    """
    all_fields = {"eval_name": eval_name, "score_value": score_value, **kwargs}
    event: dict[str, Any] = {"event.type": "gen_ai.evaluation.result"}
    event.update(
        {
            _EVAL_RESULT_FIELD_MAP[k]: v
            for k, v in all_fields.items()
            if k in _EVAL_RESULT_FIELD_MAP and v is not None
        }
    )
    if extra:
        event.update(extra)
    return event
