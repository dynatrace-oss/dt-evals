"""Unit tests for dt_ai_ingest.mlflow.evaluation."""

import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.mlflow.evaluation import export_evaluation_results


class TestExportEvaluationResults:
    def _make_result(self, metrics: dict) -> SimpleNamespace:
        """Create a minimal mlflow EvaluationResult-like object."""
        return SimpleNamespace(metrics=metrics)

    def test_exports_mean_metrics(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "answer_length/mean": 12.5,
            }
        )

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client, experiment="test-exp")

        assert "[dry-run]" in caplog.text
        assert "exact_match" in caplog.text
        assert "answer_length" in caplog.text

    def test_skips_non_mean_aggregates(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "exact_match/p50": 0.80,
                "exact_match/variance": 0.02,
            }
        )

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client)

        # Only mean should be sent (1 event)
        assert "exact_match" in caplog.text
        # The p50 and variance values should not appear as event names
        log_text = caplog.text
        events_json = log_text[log_text.index("[dry-run]") :]
        assert "0.80" not in events_json or "p50" not in events_json

    def test_skips_non_numeric_metrics(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "artifact_path": "/path/to/artifact",  # string, should be skipped
            }
        )

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client)

        assert "exact_match" in caplog.text
        assert "artifact_path" not in caplog.text

    def test_no_events_when_no_numeric_metrics(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = self._make_result({"artifact_path": "/path"})

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client)

        assert "[dry-run]" not in caplog.text

    def test_mlflow_context_fields_in_extra(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = self._make_result({"exact_match/mean": 0.85})

        with caplog.at_level(logging.INFO):
            export_evaluation_results(
                result,
                client,
                run_id="run-123",
                experiment="my-exp",
                model_id="model-456",
                dataset_name="test-data",
            )

        assert "run-123" in caplog.text
        assert "my-exp" in caplog.text

    def test_eval_kwargs_forwarded(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = self._make_result({"exact_match/mean": 0.85})

        with caplog.at_level(logging.INFO):
            export_evaluation_results(
                result,
                client,
                eval_method="code_based",
                scoring_format="score_0_to_1",
            )

        assert "code_based" in caplog.text

    def test_sends_to_dynatrace(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "faithfulness/mean": 0.72,
            }
        )

        export_evaluation_results(
            result,
            client,
            run_id="run-abc",
            experiment="e2e-test",
            eval_method="code_based",
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)

        assert len(body) == 2
        names = {e["gen_ai.evaluation.name"] for e in body}
        assert names == {"exact_match", "faithfulness"}

        for event in body:
            assert event["event.type"] == "gen_ai.evaluation.result"
            assert event["gen_ai.evaluation.method"] == "code_based"
            assert event["event.provider"] == "mlflow"
            assert event["mlflow.run_id"] == "run-abc"
            assert event["mlflow.experiment"] == "e2e-test"

    def test_export_works_in_running_loop(self, httpx_mock):
        """Simulate Jupyter: call export_evaluation_results from a running event loop."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = self._make_result({"exact_match/mean": 0.85})

        async def _wrapper():
            # Inside a running loop — the old asyncio.run() would have crashed here.
            export_evaluation_results(result, client, run_id="jupyter-test")

        asyncio.run(_wrapper())

        requests = httpx_mock.get_requests()
        assert len(requests) == 1


class TestMetricFiltering:
    """Tests for non-score metric filtering in export_evaluation_results."""

    def _make_result(self, metrics: dict) -> SimpleNamespace:
        return SimpleNamespace(metrics=metrics)

    def test_num_items_filtered_by_default(self, caplog):
        """num_items should NOT become a BizEvent by default."""
        client = DynatraceClient(dry_run=True)
        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "num_items": 100,
            }
        )

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client)

        assert "exact_match" in caplog.text
        assert "num_items" not in caplog.text

    def test_total_tokens_filtered_by_default(self, caplog):
        client = DynatraceClient(dry_run=True)
        result = self._make_result(
            {
                "faithfulness/mean": 0.9,
                "total_tokens": 5000,
                "input_tokens": 3000,
                "output_tokens": 2000,
            }
        )

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client)

        assert "faithfulness" in caplog.text
        assert "total_tokens" not in caplog.text
        assert "input_tokens" not in caplog.text
        assert "output_tokens" not in caplog.text

    def test_num_items_with_mean_suffix_filtered(self, caplog):
        """num_items/mean should also be filtered (normalised to num_items)."""
        client = DynatraceClient(dry_run=True)
        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "num_items/mean": 100.0,
            }
        )

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client)

        assert "exact_match" in caplog.text
        assert "num_items" not in caplog.text

    def test_custom_blocklist_parameter(self, httpx_mock):
        """User can pass a custom blocklist to filter additional metrics."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "my_custom_count/mean": 42.0,
            }
        )

        export_evaluation_results(
            result,
            client,
            metric_blocklist={"my_custom_count"},
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)
        names = {e["gen_ai.evaluation.name"] for e in body}
        assert names == {"exact_match"}

    def test_allowlist_keeps_only_listed_metrics(self, httpx_mock):
        """With an allowlist, only specified metrics are exported."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = self._make_result(
            {
                "exact_match/mean": 0.85,
                "faithfulness/mean": 0.72,
                "relevance/mean": 0.91,
                "num_items": 100,
            }
        )

        export_evaluation_results(
            result,
            client,
            metric_allowlist={"exact_match", "faithfulness"},
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)
        names = {e["gen_ai.evaluation.name"] for e in body}
        assert names == {"exact_match", "faithfulness"}

    def test_allowlist_overrides_default_blocklist(self, httpx_mock):
        """A metric in the default blocklist can be exported if it's in the allowlist."""
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        result = self._make_result(
            {
                "num_items": 100,
                "exact_match/mean": 0.85,
            }
        )

        export_evaluation_results(
            result,
            client,
            metric_allowlist={"num_items", "exact_match"},
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)
        names = {e["gen_ai.evaluation.name"] for e in body}
        assert names == {"num_items", "exact_match"}

    def test_no_events_when_all_filtered(self, caplog):
        """When all metrics are non-score, no events should be sent."""
        client = DynatraceClient(dry_run=True)
        result = self._make_result(
            {
                "num_items": 100,
                "total_tokens": 5000,
            }
        )

        with caplog.at_level(logging.INFO):
            export_evaluation_results(result, client)

        assert "[dry-run]" not in caplog.text
