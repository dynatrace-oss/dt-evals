"""Tests for dt_ai_ingest.schema."""

import pytest
from pydantic import ValidationError

from dt_ai_ingest.schema import EvalEvent, build_eval_result_event


class TestEvalEvent:
    def test_minimal_payload(self):
        e = EvalEvent(
            evaluation_name="faithfulness",
            scoring_format="score_0_to_1",
            score_value=0.85,
        )
        payload = e.to_bizevents_payload()

        assert payload["event.type"] == "gen_ai.evaluation.result"
        assert payload["gen_ai.evaluation.name"] == "faithfulness"
        assert payload["gen_ai.evaluation.score.value"] == 0.85
        assert payload["gen_ai.evaluation.scoring_format"] == "score_0_to_1"
        assert payload["gen_ai.evaluation.method"] == "programmatic"
        assert payload["gen_ai.evaluation.type"] == "ready_made"

    def test_optional_fields_excluded_when_none(self):
        e = EvalEvent(
            evaluation_name="test",
            scoring_format="score_0_to_1",
        )
        payload = e.to_bizevents_payload()

        assert "gen_ai.evaluation.score.value" not in payload
        assert "gen_ai.evaluation.score.label" not in payload
        assert "trace_id" not in payload
        assert "span_id" not in payload
        assert "gen_ai.evaluation.explanation" not in payload
        assert "gen_ai.usage.input_tokens" not in payload

    def test_all_optional_fields_included(self):
        e = EvalEvent(
            evaluation_name="test",
            scoring_format="discrete",
            score_value=1.0,
            score_label="pass",
            trace_id="abc123",
            span_id="def456",
            response_id="trail-1",
            explanation="Looks good",
            method="llm_as_judge",
            input_tokens=100,
            output_tokens=50,
            response_model="gpt-4o",
        )
        payload = e.to_bizevents_payload()

        assert payload["trace_id"] == "abc123"
        assert payload["span_id"] == "def456"
        assert payload["gen_ai.response.id"] == "trail-1"
        assert payload["gen_ai.evaluation.explanation"] == "Looks good"
        assert payload["gen_ai.evaluation.score.label"] == "pass"
        assert payload["gen_ai.usage.input_tokens"] == 100
        assert payload["gen_ai.usage.output_tokens"] == 50
        assert payload["gen_ai.response.model"] == "gpt-4o"


class TestBuildEvalResultEvent:
    def test_basic_event(self):
        event = build_eval_result_event(eval_name="exact_match", score_value=0.92)

        assert event["event.type"] == "gen_ai.evaluation.result"
        assert event["gen_ai.evaluation.name"] == "exact_match"
        assert event["gen_ai.evaluation.score.value"] == 0.92

    def test_with_kwargs(self):
        event = build_eval_result_event(
            eval_name="faithfulness",
            score_value=0.75,
            eval_method="llm_as_judge",
            provider_name="openai",
            request_model="gpt-4.1-mini",
        )

        assert event["gen_ai.evaluation.method"] == "llm_as_judge"
        assert event["gen_ai.provider.name"] == "openai"
        assert event["gen_ai.request.model"] == "gpt-4.1-mini"

    def test_unknown_kwargs_ignored(self):
        event = build_eval_result_event(
            eval_name="test",
            score_value=1.0,
            unknown_field="should be ignored",
        )

        assert "unknown_field" not in event

    def test_extra_dict_merged(self):
        event = build_eval_result_event(
            eval_name="test",
            score_value=1.0,
            extra={"mlflow.run_id": "run-123", "custom.key": "value"},
        )

        assert event["mlflow.run_id"] == "run-123"
        assert event["custom.key"] == "value"

    def test_none_values_excluded(self):
        event = build_eval_result_event(
            eval_name="test",
            score_value=0.5,
            trace_id=None,
            span_id=None,
        )

        assert "trace_id" not in event
        assert "span_id" not in event

    def test_adapter_name_field(self):
        event = build_eval_result_event(
            eval_name="test",
            score_value=1.0,
            adapter_name="mlflow",
        )

        assert event["event.provider"] == "mlflow"

    def test_adapter_name_via_extra(self):
        event = build_eval_result_event(
            eval_name="test",
            score_value=1.0,
            extra={"event.provider": "ragas"},
        )

        assert event["event.provider"] == "ragas"


class TestScoreRangeValidation:
    """Verify EvalEvent rejects scores outside the declared scoring_format range."""

    def test_score_within_0_to_1_accepted(self):
        e = EvalEvent(
            evaluation_name="test",
            scoring_format="score_0_to_1",
            score_value=0.5,
        )
        assert e.score_value == 0.5

    def test_score_at_boundaries_accepted(self):
        EvalEvent(evaluation_name="test", scoring_format="score_0_to_1", score_value=0.0)
        EvalEvent(evaluation_name="test", scoring_format="score_0_to_1", score_value=1.0)

    def test_score_above_range_rejected(self):
        with pytest.raises(ValidationError, match="outside the valid range"):
            EvalEvent(
                evaluation_name="test",
                scoring_format="score_0_to_1",
                score_value=1.5,
            )

    def test_score_below_range_rejected(self):
        with pytest.raises(ValidationError, match="outside the valid range"):
            EvalEvent(
                evaluation_name="test",
                scoring_format="score_0_to_1",
                score_value=-0.1,
            )

    def test_none_score_with_ranged_format_accepted(self):
        e = EvalEvent(
            evaluation_name="test",
            scoring_format="score_0_to_1",
        )
        assert e.score_value is None

    def test_discrete_format_allows_any_score(self):
        e = EvalEvent(
            evaluation_name="test",
            scoring_format="discrete",
            score_value=42.0,
        )
        assert e.score_value == 42.0

    def test_unknown_format_allows_any_score(self):
        e = EvalEvent(
            evaluation_name="test",
            scoring_format="custom_format",
            score_value=999.0,
        )
        assert e.score_value == 999.0

    def test_score_0_to_5_range(self):
        EvalEvent(evaluation_name="test", scoring_format="score_0_to_5", score_value=3.5)
        with pytest.raises(ValidationError, match="outside the valid range"):
            EvalEvent(evaluation_name="test", scoring_format="score_0_to_5", score_value=5.1)
