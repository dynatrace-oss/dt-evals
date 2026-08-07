"""The single evaluation-result model and its BizEvent serialization.

``Eval`` is the one representation an evaluation takes inside this library.
``Eval.to_bizevent()`` is the only serializer to the wire — a flat Dynatrace
BizEvent dict of ``event.type = gen_ai.evaluation.result``.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

EVENT_TYPE = "gen_ai.evaluation.result"

# scoring_format -> inclusive upper bound (the lower bound is always 0).
SCORING_RANGES: dict[str, float] = {
    "score_0_to_1": 1.0,
    "score_0_to_5": 5.0,
    "score_0_to_10": 10.0,
    "score_0_to_100": 100.0,
}

# Eval field -> BizEvent dot-key. Drives to_bizevent(); the field set is aligned
# with what the GenAI Observability app renders in the Prompts / Evals view.
_FIELD_MAP: dict[str, str] = {
    "name": "gen_ai.evaluation.name",
    "score": "gen_ai.evaluation.score.value",
    "label": "gen_ai.evaluation.score.label",
    "scoring_format": "gen_ai.evaluation.scoring_format",
    "explanation": "gen_ai.evaluation.explanation",
    "method": "gen_ai.evaluation.method",
    "question": "gen_ai.evaluation.input.question",
    "answer": "gen_ai.evaluation.input.answer",
    "system_prompt": "gen_ai.evaluation.input.system_prompt",
    "model": "gen_ai.request.model",
    "trace_id": "trace_id",
    "span_id": "span_id",
    "run_id": "dt.eval.run_id",
    "span_start": "span.start_time",
    "span_end": "span.end_time",
}


class Eval(BaseModel):
    """One evaluation result -> one ``gen_ai.evaluation.result`` BizEvent."""

    model_config = ConfigDict(extra="forbid")

    name: str
    score: float | None = None
    label: str | None = None
    scoring_format: str = "score_0_to_1"
    explanation: str | None = None
    method: str = "programmatic"

    question: str | None = None
    answer: str | None = None
    system_prompt: str | None = None
    model: str | None = None

    trace_id: str | None = None
    span_id: str | None = None
    run_id: str | None = None
    span_start: str | None = None
    span_end: str | None = None

    provider: str = "custom"
    extra: dict[str, Any] = {}

    @model_validator(mode="after")
    def _validate_score(self) -> Eval:
        if self.scoring_format not in SCORING_RANGES:
            raise ValueError(
                f"unknown scoring_format {self.scoring_format!r}; "
                f"expected one of {sorted(SCORING_RANGES)}"
            )
        if self.score is not None:
            upper = SCORING_RANGES[self.scoring_format]
            if not 0 <= self.score <= upper:
                raise ValueError(
                    f"score {self.score} out of range 0..{upper} for {self.scoring_format}"
                )
        return self

    def to_bizevent(self) -> dict[str, Any]:
        """Serialize to a flat Dynatrace BizEvent dict."""
        event: dict[str, Any] = {
            "event.type": EVENT_TYPE,
            "event.provider": self.provider,
        }
        for field, key in _FIELD_MAP.items():
            value = getattr(self, field)
            if value is not None:
                event[key] = value
        # Passthrough never overrides an authoritative key already set above.
        for key, value in self.extra.items():
            event.setdefault(key, value)
        return event
