"""Unit tests for dt_ai_ingest.deepeval.evaluation."""

import asyncio
import json
import logging
from types import SimpleNamespace
from typing import Any

import pytest

from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.deepeval.evaluation import export_deepeval_results


def _make_metric(
    name: str = "AnswerRelevancy",
    threshold: float = 0.5,
    success: bool = True,
    score: float | None = 0.87,
    reason: str | None = None,
    evaluation_model: str | None = "gpt-4o",
    error: str | None = None,
) -> SimpleNamespace:
    """Create a minimal DeepEval MetricData-like object."""
    return SimpleNamespace(
        name=name,
        threshold=threshold,
        success=success,
        score=score,
        reason=reason,
        evaluation_model=evaluation_model,
        error=error,
    )


def _make_test_result(
    name: str = "test_case_0",
    success: bool = True,
    metrics_data: list[SimpleNamespace] | None = None,
    conversational: bool = False,
) -> SimpleNamespace:
    """Create a minimal DeepEval TestResult-like object."""
    return SimpleNamespace(
        name=name,
        success=success,
        metrics_data=metrics_data or [],
        conversational=conversational,
    )


def _make_result(
    test_results: list[SimpleNamespace] | None = None,
    test_run_id: str | None = "run-abc-123",
) -> SimpleNamespace:
    """Create a minimal DeepEval EvaluationResult-like object."""
    return SimpleNamespace(
        test_results=test_results or [],
        test_run_id=test_run_id,
    )


# ---------------------------------------------------------------------------
# Core export — per test case, per metric
# ---------------------------------------------------------------------------


class TestExportDeepEvalResults:
    def test_emits_one_event_per_metric_per_test_case(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    name="tc_1",
                    metrics_data=[
                        _make_metric(name="AnswerRelevancy", score=0.87),
                        _make_metric(name="Faithfulness", score=0.92),
                    ],
                ),
                _make_test_result(
                    name="tc_2",
                    metrics_data=[
                        _make_metric(name="AnswerRelevancy", score=0.75),
                        _make_metric(name="Faithfulness", score=0.81),
                    ],
                ),
            ],
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        # 2 test cases × 2 metrics = 4 events
        assert len(body) == 4

    def test_event_structure(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    name="my_test",
                    success=True,
                    conversational=False,
                    metrics_data=[
                        _make_metric(
                            name="AnswerRelevancy",
                            threshold=0.5,
                            success=True,
                            score=0.87,
                            evaluation_model="gpt-4o",
                        ),
                    ],
                ),
            ],
            test_run_id="run-xyz",
        )

        export_deepeval_results(
            result,
            client,
            test_run_name="my-run",
            dataset_name="qa-ds",
        )

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 1
        event = body[0]

        assert event["event.type"] == "gen_ai.evaluation.result"
        assert event["gen_ai.evaluation.name"] == "AnswerRelevancy"
        assert event["gen_ai.evaluation.score.value"] == pytest.approx(0.87)
        assert event["gen_ai.evaluation.score.label"] == "pass"
        assert event["event.provider"] == "deepeval"
        assert event["deepeval.test_case_name"] == "my_test"
        assert event["deepeval.test_case_index"] == 0
        assert event["deepeval.test_case_success"] is True
        assert event["deepeval.metric_success"] is True
        assert event["deepeval.metric_threshold"] == pytest.approx(0.5)
        assert event["deepeval.evaluation_model"] == "gpt-4o"
        assert event["deepeval.num_test_cases"] == 1
        assert event["deepeval.test_run_id"] == "run-xyz"
        assert event["deepeval.test_run_name"] == "my-run"
        assert event["deepeval.dataset_name"] == "qa-ds"
        assert event["deepeval.conversational"] is False

    def test_pass_fail_labels(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    name="tc",
                    success=False,
                    metrics_data=[
                        _make_metric(name="M1", success=True, score=0.8),
                        _make_metric(name="M2", success=False, score=0.3),
                    ],
                ),
            ],
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        labels = {e["gen_ai.evaluation.name"]: e["gen_ai.evaluation.score.label"] for e in body}
        assert labels == {"M1": "pass", "M2": "fail"}

    def test_conversational_flag(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    name="conv_test",
                    conversational=True,
                    metrics_data=[_make_metric(score=0.9)],
                ),
            ],
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["deepeval.conversational"] is True

    def test_evaluation_model_included(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[
                        _make_metric(evaluation_model="claude-3-sonnet", score=0.85),
                    ],
                ),
            ],
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["deepeval.evaluation_model"] == "claude-3-sonnet"

    def test_threshold_in_event(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[
                        _make_metric(threshold=0.7, score=0.85),
                    ],
                ),
            ],
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["deepeval.metric_threshold"] == pytest.approx(0.7)


# ---------------------------------------------------------------------------
# Error / edge cases
# ---------------------------------------------------------------------------


class TestExportDeepEvalResultsEdgeCases:
    def test_empty_test_results_logs_warning(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = _make_result(test_results=[])

        with caplog.at_level(logging.WARNING):
            export_deepeval_results(result, client)

        assert "no test results" in caplog.text.lower()

    def test_metric_with_no_score_emits_event_without_score(self, httpx_mock):
        """Errored metrics (score=None) still emit a BizEvent for monitoring."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[
                        _make_metric(
                            name="Faithfulness",
                            score=None,
                            success=False,
                            error="LLM judge timed out",
                        ),
                    ],
                ),
            ],
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 1
        event = body[0]
        assert event["gen_ai.evaluation.name"] == "Faithfulness"
        assert "gen_ai.evaluation.score.value" not in event
        assert event["gen_ai.evaluation.score.label"] == "fail"
        assert event["deepeval.metric_error"] == "LLM judge timed out"

    def test_metric_with_nan_score_emits_as_error(self, httpx_mock):
        """NaN score is treated same as None — no score_value in event."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[
                        _make_metric(name="M1", score=float("nan"), success=False),
                    ],
                ),
            ],
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 1
        assert "gen_ai.evaluation.score.value" not in body[0]

    def test_empty_metrics_data_skipped(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = _make_result(
            test_results=[
                _make_test_result(name="tc_empty", metrics_data=[]),
            ],
        )

        with caplog.at_level(logging.WARNING):
            export_deepeval_results(result, client)

        assert "no metric results" in caplog.text.lower()

    def test_no_test_run_id(self, httpx_mock):
        """test_run_id can be None."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[_make_metric(score=0.9)],
                ),
            ],
            test_run_id=None,
        )

        export_deepeval_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        assert "deepeval.test_run_id" not in body[0]


# ---------------------------------------------------------------------------
# Extra / kwargs forwarding
# ---------------------------------------------------------------------------


class TestExportDeepEvalResultsExtras:
    def test_extra_merged_into_events(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[_make_metric(score=0.9)],
                ),
            ],
        )

        export_deepeval_results(result, client, extra={"custom.key": "val"})

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["custom.key"] == "val"
        assert body[0]["event.provider"] == "deepeval"

    def test_eval_kwargs_forwarded(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[_make_metric(score=0.9)],
                ),
            ],
        )

        export_deepeval_results(
            result,
            client,
            eval_method="llm_as_judge",
            scoring_format="score_0_to_1",
        )

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["gen_ai.evaluation.method"] == "llm_as_judge"
        assert body[0]["gen_ai.evaluation.scoring_format"] == "score_0_to_1"

    def test_dry_run_logs_events(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[_make_metric(score=0.9)],
                ),
            ],
        )

        with caplog.at_level(logging.INFO):
            export_deepeval_results(result, client)

        assert "[dry-run]" in caplog.text


# ---------------------------------------------------------------------------
# Integration
# ---------------------------------------------------------------------------


class TestExportDeepEvalResultsIntegration:
    def test_sends_to_dynatrace(self, httpx_mock):
        """Full flow: mock result → export → verify HTTP request."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    name="qa_test_1",
                    success=True,
                    metrics_data=[
                        _make_metric(name="AnswerRelevancy", score=0.87, success=True),
                        _make_metric(name="Faithfulness", score=0.92, success=True),
                    ],
                ),
                _make_test_result(
                    name="qa_test_2",
                    success=False,
                    metrics_data=[
                        _make_metric(name="AnswerRelevancy", score=0.45, success=False),
                        _make_metric(name="Faithfulness", score=0.88, success=True),
                    ],
                ),
            ],
            test_run_id="run-e2e",
        )

        export_deepeval_results(
            result,
            client,
            test_run_name="e2e-test",
            eval_method="llm_as_judge",
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)

        assert len(body) == 4

        # Check all events have the right adapter
        for event in body:
            assert event["event.type"] == "gen_ai.evaluation.result"
            assert event["event.provider"] == "deepeval"
            assert event["deepeval.test_run_id"] == "run-e2e"
            assert event["deepeval.test_run_name"] == "e2e-test"
            assert event["gen_ai.evaluation.method"] == "llm_as_judge"

        # Check pass/fail distribution
        labels = [e["gen_ai.evaluation.score.label"] for e in body]
        assert labels.count("pass") == 3
        assert labels.count("fail") == 1

    def test_export_works_in_running_loop(self, httpx_mock):
        """Simulate Jupyter: call from inside a running event loop."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            test_results=[
                _make_test_result(
                    metrics_data=[_make_metric(score=0.85)],
                ),
            ],
        )

        async def _wrapper():
            export_deepeval_results(result, client)

        asyncio.run(_wrapper())

        requests = httpx_mock.get_requests()
        assert len(requests) == 1
