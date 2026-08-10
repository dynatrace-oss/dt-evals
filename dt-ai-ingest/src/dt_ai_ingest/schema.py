"""The single evaluation-result model and its BizEvent serialization.

``Eval`` is the one representation an evaluation takes inside this library.
``Eval.to_bizevent()`` is the only serializer to the wire — a flat Dynatrace
BizEvent dict of ``event.type = gen_ai.evaluation.result``. The key set and
values mirror the ground-truth payload emitted by dt-eval-cli's ``bizevent.ts``
so both clients render identically in the GenAI Observability app.
"""

from __future__ import annotations

from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

EVENT_TYPE = "gen_ai.evaluation.result"

# This library, as recorded in the BizEvent's client-identity keys.
CLIENT_NAME = "dt-ai-ingest"
try:
    CLIENT_VERSION = _pkg_version("dt-ai-ingest")
except PackageNotFoundError:
    CLIENT_VERSION = "dev"

# scoring_format -> (inclusive lower bound, inclusive upper bound). Only the two
# formats dt-eval-cli emits are accepted, so both clients render identically.
SCORING_RANGES: dict[str, tuple[float, float]] = {
    "score_0_to_1": (0.0, 1.0),
    "score_1_to_5": (1.0, 5.0),
}

# Eval field -> BizEvent dot-key. Drives to_bizevent(); the field set is aligned
# with what the GenAI Observability app renders in the Prompts / Evals view.
_FIELD_MAP: dict[str, str] = {
    # Metric identity
    "name": "gen_ai.evaluation.name",
    # Score
    "score": "gen_ai.evaluation.score.value",
    "label": "gen_ai.evaluation.score.label",
    "scoring_format": "gen_ai.evaluation.scoring_format",
    # Scoring metadata
    "explanation": "gen_ai.evaluation.explanation",
    "method": "gen_ai.evaluation.method",
    # Evaluated turn
    "question": "gen_ai.evaluation.input.question",
    "answer": "gen_ai.evaluation.input.answer",
    "system_prompt": "gen_ai.evaluation.input.system_prompt",
    # Judge / provider
    "model": "gen_ai.request.model",
    "model_provider": "gen_ai.provider.name",
    "service_name": "dt.service.name",
    # Span linkage
    "trace_id": "trace_id",
    "span_id": "span_id",
    # Run / dataset grouping
    "run_id": "dt.eval.run_id",
    "dataset_id": "dt.eval.dataset_id",
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
    method: str | None = None

    question: str | None = None
    answer: str | None = None
    system_prompt: str | None = None
    model: str | None = None
    model_provider: str | None = None

    service_name: str | None = None
    trace_id: str | None = None
    span_id: str | None = None
    run_id: str | None = None
    dataset_id: str | None = None
    span_start: str | None = None
    span_end: str | None = None

    extra: dict[str, Any] = {}

    @model_validator(mode="after")
    def _validate_score(self) -> Eval:
        if self.scoring_format not in SCORING_RANGES:
            raise ValueError(
                f"unknown scoring_format {self.scoring_format!r}; "
                f"expected one of {sorted(SCORING_RANGES)}"
            )
        if self.score is not None:
            lower, upper = SCORING_RANGES[self.scoring_format]
            if not lower <= self.score <= upper:
                raise ValueError(
                    f"score {self.score} out of range {lower}..{upper} for {self.scoring_format}"
                )
        return self

    def to_bizevent(self) -> dict[str, Any]:
        """Serialize to a flat Dynatrace BizEvent dict."""
        event: dict[str, Any] = {
            "event.type": EVENT_TYPE,
            "event.provider": CLIENT_NAME,
            "gen_ai.eval.client": CLIENT_NAME,
            "gen_ai.eval.client.version": CLIENT_VERSION,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        for field, key in _FIELD_MAP.items():
            value = getattr(self, field)
            if value is not None:
                event[key] = value
        if self.span_id is not None:
            event["gen_ai.response.id"] = self.span_id
        # Passthrough never overrides an authoritative key already set above.
        for key, value in self.extra.items():
            event.setdefault(key, value)
        return event
