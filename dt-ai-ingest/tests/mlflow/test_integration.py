"""Integration tests — MLflow → Dynatrace (real tenant).

These tests send actual BizEvents and OTel traces to the Dynatrace tenant
configured via environment variables, then query Grail to verify the data
arrived.

Prerequisites
~~~~~~~~~~~~~
Set the following environment variables (or use a .env file):

    DT_ENDPOINT=https://<env-id>.live.dynatrace.com
    DT_ACCESS_TOKEN=<your-access-token>

Run
~~~
    uv run pytest tests/mlflow/test_integration.py -v -m integration

These tests are skipped by default unless ``--run-integration`` is passed
or the ``DT_ENDPOINT`` env var is set.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from types import SimpleNamespace

import httpx
import pytest

from dt_ai_ingest.auth import make_auth_header
from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.mlflow.evaluation import export_evaluation_results

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DT_ENDPOINT = os.environ.get("DT_ENDPOINT", "").rstrip("/")
_DT_ACCESS_TOKEN = os.environ.get("DT_ACCESS_TOKEN", "")

_skip_reason = "DT_ENDPOINT and DT_ACCESS_TOKEN env vars required for integration tests"
_needs_tenant = pytest.mark.skipif(
    not (_DT_ENDPOINT and _DT_ACCESS_TOKEN),
    reason=_skip_reason,
)

# All integration tests carry the ``integration`` marker so they can be
# selected or excluded easily:  pytest -m integration / pytest -m "not integration"
pytestmark = [pytest.mark.integration, _needs_tenant]


def _grail_query(dql: str, *, timeout_seconds: int = 60) -> list[dict]:
    """Execute a DQL query against the Grail query API and return result records.

    Uses the ``/platform/storage/query/v1/query:execute`` endpoint which runs
    the query synchronously (up to *timeout_seconds*).
    """
    url = f"{_DT_ENDPOINT}/platform/storage/query/v1/query:execute"
    headers = {
        "Authorization": make_auth_header(_DT_ACCESS_TOKEN),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = {
        "query": dql,
        "defaultTimeframeStart": "now()-10m",
        "defaultTimeframeEnd": "now()",
        "requestTimeoutMilliseconds": timeout_seconds * 1000,
    }

    with httpx.Client(timeout=timeout_seconds + 10) as client:
        resp = client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

    records = data.get("result", {}).get("records", []) or []
    return records


def _wait_for_grail(dql: str, *, retries: int = 10, delay: float = 5.0) -> list[dict]:
    """Poll Grail until at least one record is returned or retries are exhausted."""
    for attempt in range(retries):
        records = _grail_query(dql)
        if records:
            return records
        time.sleep(delay)
    return []


# ---------------------------------------------------------------------------
# BizEvents integration
# ---------------------------------------------------------------------------

class TestBizEventsIntegration:
    """Send MLflow evaluation BizEvents and verify they appear in Grail."""

    def test_ingest_and_query_bizevents(self):
        """Full round-trip: ingest eval metrics → query them back via DQL."""
        # Unique marker so we only find our own events
        test_run_id = f"integration-test-{uuid.uuid4().hex[:12]}"

        client = DynatraceClient(
            tenant_url=_DT_ENDPOINT,
            access_token=_DT_ACCESS_TOKEN,
            dry_run=False,
        )

        result = SimpleNamespace(metrics={
            "faithfulness/mean": 0.91,
            "relevance/mean": 0.78,
            "answer_length/mean": 42.0,
        })

        export_evaluation_results(
            result,
            client,
            run_id=test_run_id,
            experiment="integration-test",
            eval_method="code_based",
            scoring_format="score_0_to_1",
        )

        # Query Grail — BizEvents need a few seconds to become queryable
        dql = (
            'fetch bizevents'
            ' | filter event.type == "gen_ai.evaluation.result"'
            f' | filter mlflow.run_id == "{test_run_id}"'
            ' | fields `gen_ai.evaluation.name`, `gen_ai.evaluation.score.value`,'
            '          `gen_ai.evaluation.method`, `mlflow.run_id`, `mlflow.experiment`'
            ' | sort `gen_ai.evaluation.name` asc'
        )

        records = _wait_for_grail(dql, retries=12, delay=5.0)

        assert len(records) == 3, f"Expected 3 BizEvents, got {len(records)}: {records}"

        names = {r["gen_ai.evaluation.name"] for r in records}
        assert names == {"answer_length", "faithfulness", "relevance"}

        for r in records:
            assert r["mlflow.run_id"] == test_run_id
            assert r["mlflow.experiment"] == "integration-test"
            assert r["gen_ai.evaluation.method"] == "code_based"
            assert isinstance(r["gen_ai.evaluation.score.value"], (int, float))


# ---------------------------------------------------------------------------
# OTel traces integration
# ---------------------------------------------------------------------------

class TestTracesIntegration:
    """Send OTel traces via MLflow tracing and verify they appear in Grail."""

    def test_ingest_and_query_traces(self):
        """Full round-trip: export MLflow OTel spans → query them in Grail."""
        import mlflow

        from dt_ai_ingest.mlflow.tracing import configure_dynatrace_tracing

        # Unique service name so we only find our own spans
        test_service = f"integration-test-{uuid.uuid4().hex[:8]}"

        provider = configure_dynatrace_tracing(
            dt_endpoint=_DT_ENDPOINT,
            dt_access_token=_DT_ACCESS_TOKEN,
            service_name=test_service,
        )

        # Run a traced function
        @mlflow.trace(span_type="LLM", name="test_llm_call")
        def fake_llm(prompt: str) -> str:
            return f"mocked: {prompt}"

        mlflow.set_experiment("integration-test-traces")

        with mlflow.start_run(run_name="trace-integration"):
            fake_llm("What is Dynatrace?")
            fake_llm("How does AI Obs work?")

        # Force-flush spans so they're exported before we query
        provider.force_flush(timeout_millis=10_000)

        # Query Grail for the spans
        dql = (
            'fetch spans'
            f' | filter service.name == "{test_service}"'
            ' | fields service.name, span.name, timestamp'
            ' | sort timestamp desc'
            ' | limit 10'
        )

        records = _wait_for_grail(dql, retries=15, delay=5.0)

        assert len(records) >= 2, (
            f"Expected at least 2 spans for service '{test_service}', "
            f"got {len(records)}: {records}"
        )

        service_names = {r["service.name"] for r in records}
        assert test_service in service_names
