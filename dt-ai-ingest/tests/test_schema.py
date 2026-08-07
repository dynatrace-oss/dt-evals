"""Tests for the Eval model and its BizEvent serialization."""

from __future__ import annotations

import pytest

from dt_ai_ingest.schema import EVENT_TYPE, Eval


def test_minimal_eval_to_bizevent():
    payload = Eval(name="faithfulness", score=0.9).to_bizevent()
    assert payload["event.type"] == EVENT_TYPE
    assert payload["event.provider"] == "custom"
    assert payload["gen_ai.evaluation.name"] == "faithfulness"
    assert payload["gen_ai.evaluation.score.value"] == 0.9
    assert payload["gen_ai.evaluation.scoring_format"] == "score_0_to_1"


def test_score_out_of_range_raises():
    with pytest.raises(ValueError, match="out of range"):
        Eval(name="x", score=5.0, scoring_format="score_0_to_1")


def test_unknown_scoring_format_raises():
    with pytest.raises(ValueError, match="unknown scoring_format"):
        Eval(name="x", score=0.5, scoring_format="bananas")


def test_unknown_field_rejected():
    with pytest.raises(ValueError):
        Eval(name="x", scoer=0.5)  # typo -> extra="forbid"


def test_span_links_and_extra_passthrough():
    payload = Eval(
        name="x",
        score=1.0,
        trace_id="t",
        span_id="s",
        run_id="r",
        extra={"custom.key": "v"},
    ).to_bizevent()
    assert payload["trace_id"] == "t"
    assert payload["span_id"] == "s"
    assert payload["dt.eval.run_id"] == "r"
    assert payload["custom.key"] == "v"


def test_extra_does_not_override_authoritative_key():
    payload = Eval(name="x", provider="ragas", extra={"event.provider": "spoof"}).to_bizevent()
    assert payload["event.provider"] == "ragas"
