"""Tests for the Eval model and its BizEvent serialization."""

from __future__ import annotations

import pytest

from dt_ai_ingest.schema import CLIENT_NAME, CLIENT_VERSION, EVENT_TYPE, Eval


def test_minimal_eval_to_bizevent():
    payload = Eval(name="faithfulness", score=0.9).to_bizevent()
    assert payload["event.type"] == EVENT_TYPE
    assert payload["event.provider"] == CLIENT_NAME
    assert payload["gen_ai.eval.client"] == CLIENT_NAME
    assert payload["gen_ai.eval.client.version"] == CLIENT_VERSION
    assert "timestamp" in payload
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
        dataset_id="golden-v1",
        model="gpt-4o",
        model_provider="openai",
        extra={"custom.key": "v"},
    ).to_bizevent()
    assert payload["trace_id"] == "t"
    assert payload["span_id"] == "s"
    assert payload["gen_ai.response.id"] == "s"
    assert payload["dt.eval.run_id"] == "r"
    assert payload["dt.eval.dataset_id"] == "golden-v1"
    assert payload["gen_ai.request.model"] == "gpt-4o"
    assert payload["gen_ai.provider.name"] == "openai"
    assert payload["custom.key"] == "v"


def test_score_1_to_5_range():
    assert Eval(name="x", score=4.0, scoring_format="score_1_to_5").score == 4.0
    with pytest.raises(ValueError, match="out of range"):
        Eval(name="x", score=0.5, scoring_format="score_1_to_5")


def test_dataset_id_in_bizevent():
    payload = Eval(name="x", dataset_id="golden-set-v2").to_bizevent()
    assert payload["dt.eval.dataset_id"] == "golden-set-v2"


def test_extra_does_not_override_authoritative_key():
    payload = Eval(name="x", extra={"event.provider": "spoof"}).to_bizevent()
    assert payload["event.provider"] == "dt-ai-ingest"
