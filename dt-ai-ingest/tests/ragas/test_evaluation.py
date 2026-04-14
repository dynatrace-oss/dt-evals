"""Unit tests for dt_ai_ingest.ragas.evaluation."""

import asyncio
import json
import logging
import math
import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from dt_ai_ingest._utils import safe_float
from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.ragas.evaluation import (
    _aggregate_scores,
    export_ragas_results,
)


def _make_result(
    scores: list[dict[str, Any]],
    run_id: uuid.UUID | None = None,
) -> SimpleNamespace:
    """Create a minimal Ragas EvaluationResult-like object."""
    return SimpleNamespace(scores=scores, run_id=run_id)


# ---------------------------------------------------------------------------
# _safe_float
# ---------------------------------------------------------------------------


class TestSafeFloat:
    def test_python_float(self):
        assert safe_float(0.85) == 0.85

    def test_python_int(self):
        result = safe_float(1)
        assert result == 1.0
        assert isinstance(result, float)

    def test_nan_returns_none(self):
        assert safe_float(float("nan")) is None

    def test_string_returns_none(self):
        assert safe_float("hello") is None

    def test_none_returns_none(self):
        assert safe_float(None) is None

    def test_dict_returns_none(self):
        assert safe_float({"a": 1}) is None

    def test_numpy_float64(self):
        np = pytest.importorskip("numpy")
        result = safe_float(np.float64(0.92))
        assert result == pytest.approx(0.92)
        assert type(result) is float  # not numpy.float64

    def test_numpy_nan(self):
        np = pytest.importorskip("numpy")
        assert safe_float(np.nan) is None

    def test_positive_infinity_returns_none(self):
        assert safe_float(float("inf")) is None

    def test_negative_infinity_returns_none(self):
        assert safe_float(float("-inf")) is None

    def test_numpy_inf_returns_none(self):
        np = pytest.importorskip("numpy")
        assert safe_float(np.inf) is None


# ---------------------------------------------------------------------------
# _aggregate_scores
# ---------------------------------------------------------------------------


class TestAggregateScores:
    def test_simple_mean(self):
        scores = [{"f": 0.8}, {"f": 0.9}]
        result = _aggregate_scores(scores, ["f"])
        assert result == {"f": pytest.approx(0.85)}

    def test_nan_excluded_from_mean(self):
        scores = [{"f": 0.8}, {"f": float("nan")}]
        result = _aggregate_scores(scores, ["f"])
        assert result == {"f": pytest.approx(0.8)}

    def test_all_nan_metric_excluded(self):
        scores = [{"f": float("nan")}, {"f": float("nan")}]
        result = _aggregate_scores(scores, ["f"])
        assert result == {}

    def test_multiple_metrics(self):
        scores = [
            {"f": 0.8, "p": 0.9},
            {"f": 0.9, "p": 0.7},
        ]
        result = _aggregate_scores(scores, ["f", "p"])
        assert result == {"f": pytest.approx(0.85), "p": pytest.approx(0.8)}

    def test_missing_key_in_some_samples(self):
        scores = [{"f": 0.8, "p": 0.9}, {"f": 0.7}]
        result = _aggregate_scores(scores, ["f", "p"])
        assert result == {"f": pytest.approx(0.75), "p": pytest.approx(0.9)}


# ---------------------------------------------------------------------------
# export_ragas_results — aggregate mode (default)
# ---------------------------------------------------------------------------


class TestExportRagasResultsAggregate:
    def test_aggregate_exports_one_event_per_metric(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            scores=[
                {"faithfulness": 0.85, "answer_relevancy": 0.92},
                {"faithfulness": 0.91, "answer_relevancy": 0.88},
                {"faithfulness": 0.72, "answer_relevancy": 0.80},
            ],
        )

        export_ragas_results(result, client, dataset_name="test-ds")

        request = httpx_mock.get_request()
        body = json.loads(request.content)

        assert len(body) == 2
        names = {e["gen_ai.evaluation.name"] for e in body}
        assert names == {"faithfulness", "answer_relevancy"}

    def test_aggregate_event_structure(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        run_id = uuid.uuid4()
        result = _make_result(
            scores=[{"faithfulness": 0.85}, {"faithfulness": 0.91}],
            run_id=run_id,
        )

        export_ragas_results(
            result,
            client,
            dataset_name="my-ds",
            experiment_name="my-exp",
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)
        assert len(body) == 1
        event = body[0]

        assert event["event.type"] == "gen_ai.evaluation.result"
        assert event["gen_ai.evaluation.name"] == "faithfulness"
        assert event["gen_ai.evaluation.score.value"] == pytest.approx(0.88)
        assert event["event.provider"] == "ragas"
        assert event["ragas.num_samples"] == 2
        assert event["ragas.dataset_name"] == "my-ds"
        assert event["ragas.experiment_name"] == "my-exp"
        assert event["ragas.run_id"] == str(run_id)

    def test_aggregate_nan_filtered(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            scores=[
                {"faithfulness": 0.8, "broken": float("nan")},
                {"faithfulness": 0.9, "broken": float("nan")},
            ],
        )

        export_ragas_results(result, client)

        request = httpx_mock.get_request()
        body = json.loads(request.content)

        # Only faithfulness should be sent; broken is all NaN
        assert len(body) == 1
        assert body[0]["gen_ai.evaluation.name"] == "faithfulness"

    def test_empty_scores_logs_warning(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = _make_result(scores=[])

        with caplog.at_level(logging.WARNING):
            export_ragas_results(result, client)

        assert "no scores" in caplog.text.lower()

    def test_all_nan_scores_logs_warning(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = _make_result(scores=[{"f": float("nan")}])

        with caplog.at_level(logging.WARNING):
            export_ragas_results(result, client)

        assert "no valid" in caplog.text.lower()

    def test_experiment_name_falls_back_to_run_id(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        run_id = uuid.uuid4()
        result = _make_result(scores=[{"f": 0.9}], run_id=run_id)

        # No experiment_name provided
        export_ragas_results(result, client)

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["ragas.experiment_name"] == str(run_id)

    def test_extra_merged_into_events(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(scores=[{"f": 0.9}])

        export_ragas_results(result, client, extra={"custom.key": "val"})

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["custom.key"] == "val"
        # Ragas context fields should also be present
        assert body[0]["event.provider"] == "ragas"

    def test_eval_kwargs_forwarded(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(scores=[{"f": 0.9}])

        export_ragas_results(
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
        result = _make_result(scores=[{"f": 0.9}])

        with caplog.at_level(logging.INFO):
            export_ragas_results(result, client)

        assert "[dry-run]" in caplog.text


# ---------------------------------------------------------------------------
# export_ragas_results — per-sample mode
# ---------------------------------------------------------------------------


class TestExportRagasResultsPerSample:
    def test_per_sample_emits_one_event_per_metric_per_sample(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            scores=[
                {"f": 0.8, "p": 0.9},
                {"f": 0.9, "p": 0.7},
                {"f": 0.7, "p": 0.8},
            ],
        )

        export_ragas_results(result, client, per_sample=True)

        body = json.loads(httpx_mock.get_request().content)
        # 2 metrics × 3 samples = 6 events
        assert len(body) == 6

    def test_per_sample_includes_sample_index(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            scores=[{"f": 0.8}, {"f": 0.9}],
        )

        export_ragas_results(result, client, per_sample=True)

        body = json.loads(httpx_mock.get_request().content)
        indices = [e["ragas.sample_index"] for e in body]
        assert indices == [0, 1]

    def test_per_sample_nan_skipped(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(
            scores=[
                {"f": 0.8},
                {"f": float("nan")},
                {"f": 0.7},
            ],
        )

        export_ragas_results(result, client, per_sample=True)

        body = json.loads(httpx_mock.get_request().content)
        # NaN sample should be skipped
        assert len(body) == 2
        indices = [e["ragas.sample_index"] for e in body]
        assert indices == [0, 2]

    def test_per_sample_preserves_context_fields(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        run_id = uuid.uuid4()
        result = _make_result(scores=[{"f": 0.9}], run_id=run_id)

        export_ragas_results(
            result,
            client,
            dataset_name="ds",
            per_sample=True,
        )

        body = json.loads(httpx_mock.get_request().content)
        event = body[0]
        assert event["ragas.dataset_name"] == "ds"
        assert event["ragas.run_id"] == str(run_id)
        assert event["event.provider"] == "ragas"
        assert event["ragas.sample_index"] == 0


# ---------------------------------------------------------------------------
# Integration-style tests
# ---------------------------------------------------------------------------


class TestExportRagasResultsIntegration:
    def test_sends_to_dynatrace(self, httpx_mock):
        """Full flow: mock result → export → verify HTTP request."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        run_id = uuid.uuid4()
        result = _make_result(
            scores=[
                {"faithfulness": 0.85, "context_precision": 0.92},
                {"faithfulness": 0.72, "context_precision": 0.88},
            ],
            run_id=run_id,
        )

        export_ragas_results(
            result,
            client,
            dataset_name="qa-test",
            experiment_name="e2e-test",
            eval_method="code_based",
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)

        assert len(body) == 2
        names = {e["gen_ai.evaluation.name"] for e in body}
        assert names == {"faithfulness", "context_precision"}

        for event in body:
            assert event["event.type"] == "gen_ai.evaluation.result"
            assert event["gen_ai.evaluation.method"] == "code_based"
            assert event["ragas.run_id"] == str(run_id)
            assert event["ragas.experiment_name"] == "e2e-test"
            assert event["ragas.dataset_name"] == "qa-test"

    def test_export_works_in_running_loop(self, httpx_mock):
        """Simulate Jupyter: call export_ragas_results from a running event loop."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_result(scores=[{"faithfulness": 0.85}])

        async def _wrapper():
            # Inside a running loop — the old asyncio.run() would have crashed.
            export_ragas_results(result, client)

        asyncio.run(_wrapper())

        requests = httpx_mock.get_requests()
        assert len(requests) == 1
