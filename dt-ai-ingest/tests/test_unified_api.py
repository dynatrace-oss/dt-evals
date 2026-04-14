"""Tests for the unified DynatraceClient.export() and .configure_tracing() API."""

import logging
import uuid
from enum import Enum
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from dt_ai_ingest.client import DynatraceClient, _detect_adapter


# ---------------------------------------------------------------------------
# Mock helpers (reused patterns from adapter test suites)
# ---------------------------------------------------------------------------


def _make_ragas_result(
    scores: list[dict[str, Any]],
    run_id: uuid.UUID | None = None,
) -> SimpleNamespace:
    """Minimal Ragas EvaluationResult-like object."""
    return SimpleNamespace(scores=scores, run_id=run_id)


def _make_deepeval_metric(
    name: str = "AnswerRelevancy",
    threshold: float = 0.5,
    success: bool = True,
    score: float | None = 0.87,
    evaluation_model: str | None = "gpt-4o",
    error: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        name=name,
        threshold=threshold,
        success=success,
        score=score,
        evaluation_model=evaluation_model,
        error=error,
    )


def _make_deepeval_test_result(
    name: str = "test_case_0",
    success: bool = True,
    metrics_data: list[SimpleNamespace] | None = None,
    conversational: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        name=name,
        success=success,
        metrics_data=metrics_data or [],
        conversational=conversational,
    )


def _make_deepeval_result(
    test_results: list[SimpleNamespace],
    test_run_id: str | None = "run-001",
) -> SimpleNamespace:
    """Minimal DeepEval EvaluationResult-like object."""
    return SimpleNamespace(test_results=test_results, test_run_id=test_run_id)


def _make_mlflow_result(metrics: dict) -> SimpleNamespace:
    """Minimal MLflow EvaluationResult-like object."""
    return SimpleNamespace(metrics=metrics)


class _ScoreSource(str, Enum):
    API = "API"


def _make_langfuse_score(
    *,
    name: str = "faithfulness",
    value: float = 0.85,
    data_type: str = "NUMERIC",
    string_value: str | None = None,
    source: _ScoreSource = _ScoreSource.API,
    trace_id: str | None = "trace-abc",
    observation_id: str | None = None,
    id: str = "score-001",
    session_id: str | None = None,
    config_id: str | None = None,
    comment: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        name=name,
        value=value,
        data_type=data_type,
        string_value=string_value,
        source=source,
        trace_id=trace_id,
        observation_id=observation_id,
        session_id=session_id,
        config_id=config_id,
        comment=comment,
    )


def _make_langfuse_client(scores: list[SimpleNamespace]) -> SimpleNamespace:
    """Minimal Langfuse client-like object with .api.scores.get_many()."""
    meta = SimpleNamespace(page=1, limit=100, total_items=len(scores), total_pages=1)
    response = SimpleNamespace(data=scores, meta=meta)

    mock_scores = MagicMock()
    mock_scores.get_many.return_value = response

    mock_api = SimpleNamespace(scores=mock_scores)
    return SimpleNamespace(api=mock_api)


# ---------------------------------------------------------------------------
# _detect_adapter tests
# ---------------------------------------------------------------------------


class TestDetectAdapter:
    def test_ragas(self):
        result = _make_ragas_result(scores=[{"faithfulness": 0.9}])
        assert _detect_adapter(result) == "ragas"

    def test_deepeval(self):
        result = _make_deepeval_result(test_results=[_make_deepeval_test_result()])
        assert _detect_adapter(result) == "deepeval"

    def test_mlflow(self):
        result = _make_mlflow_result(metrics={"exact_match/mean": 0.85})
        assert _detect_adapter(result) == "mlflow"

    def test_langfuse(self):
        client = _make_langfuse_client(scores=[])
        assert _detect_adapter(client) == "langfuse"

    def test_unknown_returns_none(self):
        assert _detect_adapter("not a result") is None
        assert _detect_adapter(42) is None
        assert _detect_adapter(SimpleNamespace()) is None

    def test_deepeval_takes_priority_over_mlflow(self):
        """An object with both .test_results and .metrics is detected as deepeval."""
        result = SimpleNamespace(test_results=[], metrics={})
        assert _detect_adapter(result) == "deepeval"

    def test_ragas_scores_must_be_list(self):
        """An object with .scores that is not a list is not detected as ragas."""
        result = SimpleNamespace(scores="not-a-list")
        assert _detect_adapter(result) != "ragas"

    def test_mlflow_metrics_must_be_dict(self):
        """An object with .metrics that is not a dict is not detected as mlflow."""
        result = SimpleNamespace(metrics=[1, 2, 3])
        assert _detect_adapter(result) != "mlflow"


# ---------------------------------------------------------------------------
# DynatraceClient.export() tests
# ---------------------------------------------------------------------------


class TestExport:
    def test_export_ragas(self, caplog):
        """export() dispatches Ragas result to export_ragas_results."""
        client = DynatraceClient(dry_run=True)
        run_id = uuid.uuid4()
        result = _make_ragas_result(
            scores=[{"faithfulness": 0.9, "relevancy": 0.8}],
            run_id=run_id,
        )

        with caplog.at_level(logging.INFO):
            client.export(result, dataset_name="test-ds")

        assert "[dry-run]" in caplog.text
        assert "faithfulness" in caplog.text
        assert "relevancy" in caplog.text

    def test_export_deepeval(self, caplog):
        """export() dispatches DeepEval result to export_deepeval_results."""
        client = DynatraceClient(dry_run=True)
        metric = _make_deepeval_metric(name="Correctness", score=0.95)
        tr = _make_deepeval_test_result(metrics_data=[metric])
        result = _make_deepeval_result(test_results=[tr])

        with caplog.at_level(logging.INFO):
            client.export(result, test_run_name="my-eval")

        assert "[dry-run]" in caplog.text
        assert "Correctness" in caplog.text

    def test_export_mlflow(self, caplog):
        """export() dispatches MLflow result to export_evaluation_results."""
        client = DynatraceClient(dry_run=True)
        result = _make_mlflow_result(metrics={"exact_match/mean": 0.85, "f1/mean": 0.9})

        with caplog.at_level(logging.INFO):
            client.export(result, experiment="test-exp")

        assert "[dry-run]" in caplog.text
        assert "exact_match" in caplog.text

    def test_export_langfuse(self, caplog):
        """export() dispatches Langfuse client to export_langfuse_scores."""
        client = DynatraceClient(dry_run=True)
        score = _make_langfuse_score(name="accuracy", value=0.92)
        langfuse = _make_langfuse_client(scores=[score])

        with caplog.at_level(logging.INFO):
            client.export(langfuse, trace_ids=["trace-abc"])

        assert "[dry-run]" in caplog.text
        assert "accuracy" in caplog.text

    def test_export_unknown_raises_type_error(self):
        """export() raises TypeError for unrecognised result types."""
        client = DynatraceClient(dry_run=True)

        with pytest.raises(TypeError, match="Cannot detect framework"):
            client.export("not a result object")

    def test_export_passes_kwargs_to_ragas(self, caplog):
        """Keyword arguments are forwarded to the adapter function."""
        client = DynatraceClient(dry_run=True)
        result = _make_ragas_result(scores=[{"metric_a": 0.5}])

        with caplog.at_level(logging.INFO):
            client.export(
                result,
                dataset_name="ds",
                experiment_name="exp",
                per_sample=False,
                eval_method="llm_as_judge",
            )

        assert "[dry-run]" in caplog.text
        assert "metric_a" in caplog.text

    def test_export_passes_kwargs_to_deepeval(self, caplog):
        """Keyword arguments are forwarded to the DeepEval adapter."""
        client = DynatraceClient(dry_run=True)
        metric = _make_deepeval_metric(name="Bias", score=0.1, success=False)
        tr = _make_deepeval_test_result(metrics_data=[metric])
        result = _make_deepeval_result(test_results=[tr])

        with caplog.at_level(logging.INFO):
            client.export(result, dataset_name="bias-ds", eval_type="custom")

        assert "[dry-run]" in caplog.text
        assert "Bias" in caplog.text

    def test_export_passes_kwargs_to_mlflow(self, caplog):
        """Keyword arguments are forwarded to the MLflow adapter."""
        client = DynatraceClient(dry_run=True)
        result = _make_mlflow_result(metrics={"toxicity/mean": 0.01})

        with caplog.at_level(logging.INFO):
            client.export(
                result,
                run_id="run-abc",
                experiment="safety-eval",
                model_id="my-model",
                eval_method="code_based",
            )

        assert "[dry-run]" in caplog.text
        assert "toxicity" in caplog.text

    def test_export_passes_kwargs_to_langfuse(self, caplog):
        """Keyword arguments are forwarded to the Langfuse adapter."""
        client = DynatraceClient(dry_run=True)
        score = _make_langfuse_score(name="faithfulness", value=0.7)
        langfuse = _make_langfuse_client(scores=[score])

        with caplog.at_level(logging.INFO):
            client.export(langfuse, score_name="faithfulness", include_comments=True)

        assert "[dry-run]" in caplog.text
        assert "faithfulness" in caplog.text

    def test_export_ragas_sends_to_endpoint(self, httpx_mock):
        """export() with Ragas result sends BizEvents via HTTP when not dry-run."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_ragas_result(scores=[{"f1": 0.9}])
        client.export(result)

        requests = httpx_mock.get_requests()
        assert len(requests) == 1

    def test_export_deepeval_sends_to_endpoint(self, httpx_mock):
        """export() with DeepEval result sends BizEvents via HTTP."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        metric = _make_deepeval_metric(name="Hallucination", score=0.05)
        tr = _make_deepeval_test_result(metrics_data=[metric])
        result = _make_deepeval_result(test_results=[tr])
        client.export(result)

        requests = httpx_mock.get_requests()
        assert len(requests) == 1

    def test_export_mlflow_sends_to_endpoint(self, httpx_mock):
        """export() with MLflow result sends BizEvents via HTTP."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = _make_mlflow_result(metrics={"bleu/mean": 0.75})
        client.export(result)

        requests = httpx_mock.get_requests()
        assert len(requests) == 1


# ---------------------------------------------------------------------------
# DynatraceClient.configure_tracing() tests
# ---------------------------------------------------------------------------


class TestConfigureTracing:
    def test_configure_tracing_no_framework(self):
        """configure_tracing() without framework calls core configure_tracing."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
        )

        with patch("dt_ai_ingest._otel.configure_tracing") as mock_ct:
            mock_ct.return_value = MagicMock()
            provider = client.configure_tracing()

        mock_ct.assert_called_once_with(
            "https://test.live.dynatrace.com",
            "dt0c01.test",
            service_name="dt-ai-ingest",
        )

    def test_configure_tracing_mlflow(self):
        """configure_tracing(framework='mlflow') delegates to mlflow tracing."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
        )

        with patch("dt_ai_ingest.mlflow.tracing.configure_dynatrace_tracing") as mock_ct:
            mock_ct.return_value = MagicMock()
            provider = client.configure_tracing(framework="mlflow")

        mock_ct.assert_called_once_with(
            "https://test.live.dynatrace.com",
            "dt0c01.test",
            service_name="mlflow-eval",
        )

    def test_configure_tracing_langfuse(self):
        """configure_tracing(framework='langfuse') delegates to langfuse tracing."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
        )

        with patch("dt_ai_ingest.langfuse.tracing.configure_dynatrace_tracing") as mock_ct:
            mock_ct.return_value = MagicMock()
            provider = client.configure_tracing(framework="langfuse")

        mock_ct.assert_called_once_with(
            "https://test.live.dynatrace.com",
            "dt0c01.test",
            service_name="langfuse-eval",
        )

    def test_configure_tracing_custom_service_name(self):
        """Custom service_name overrides the default."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
        )

        with patch("dt_ai_ingest.mlflow.tracing.configure_dynatrace_tracing") as mock_ct:
            mock_ct.return_value = MagicMock()
            provider = client.configure_tracing(framework="mlflow", service_name="my-service")

        mock_ct.assert_called_once_with(
            "https://test.live.dynatrace.com",
            "dt0c01.test",
            service_name="my-service",
        )

    def test_configure_tracing_no_tenant_url_raises(self, monkeypatch):
        """configure_tracing() raises ValueError if no tenant URL."""
        monkeypatch.delenv("DT_TENANT_URL", raising=False)
        monkeypatch.delenv("DT_ACCESS_TOKEN", raising=False)
        client = DynatraceClient(access_token="dt0c01.test")

        with pytest.raises(ValueError, match="Tenant URL"):
            client.configure_tracing()

    def test_configure_tracing_no_token_raises(self, monkeypatch):
        """configure_tracing() raises ValueError if no access token."""
        monkeypatch.delenv("DT_TENANT_URL", raising=False)
        monkeypatch.delenv("DT_ACCESS_TOKEN", raising=False)
        client = DynatraceClient(tenant_url="https://test.live.dynatrace.com")

        with pytest.raises(ValueError, match="access token"):
            client.configure_tracing()
