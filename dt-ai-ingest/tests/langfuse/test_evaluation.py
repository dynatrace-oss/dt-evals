"""Unit tests for dt_ai_ingest.langfuse.evaluation."""

import asyncio
import json
import logging
from enum import Enum
from types import SimpleNamespace
from typing import Any

import pytest

from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.langfuse.evaluation import export_langfuse_scores


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------


class _ScoreSource(str, Enum):
    """Mock for langfuse.api.resources.commons.types.score_source.ScoreSource."""

    API = "API"
    EVAL = "EVAL"
    ANNOTATION = "ANNOTATION"


def _make_score(
    *,
    id: str = "score-001",
    name: str = "faithfulness",
    value: float = 0.85,
    data_type: str = "NUMERIC",
    string_value: str | None = None,
    source: _ScoreSource = _ScoreSource.API,
    trace_id: str | None = "trace-abc-123",
    observation_id: str | None = None,
    session_id: str | None = None,
    config_id: str | None = None,
    comment: str | None = None,
) -> SimpleNamespace:
    """Create a minimal Langfuse score-like object."""
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


def _make_meta(*, page: int = 1, limit: int = 100, total_items: int = 0, total_pages: int = 1):
    """Create a minimal Langfuse MetaResponse-like object."""
    return SimpleNamespace(page=page, limit=limit, total_items=total_items, total_pages=total_pages)


def _make_api_response(data: list[SimpleNamespace], *, total_pages: int = 1):
    """Create a minimal GetScoresResponse-like object."""
    return SimpleNamespace(
        data=data,
        meta=_make_meta(total_items=len(data), total_pages=total_pages),
    )


class _MockScoresClient:
    """Mock for langfuse.api.scores that returns configurable responses."""

    def __init__(self, responses: list | None = None):
        self._responses = responses or []
        self._call_idx = 0
        self.calls: list[dict[str, Any]] = []

    def get_many(self, **kwargs) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self._call_idx < len(self._responses):
            resp = self._responses[self._call_idx]
            self._call_idx += 1
            return resp
        return _make_api_response([])


class _MockApi:
    """Mock for langfuse.api with scores sub-client."""

    def __init__(self, scores: _MockScoresClient):
        self.scores = scores


def _make_langfuse_client(
    scores: list[SimpleNamespace], *, total_pages: int = 1
) -> SimpleNamespace:
    """Create a mock Langfuse client with pre-configured score responses."""
    response = _make_api_response(scores, total_pages=total_pages)
    mock_scores = _MockScoresClient(responses=[response])
    mock_api = _MockApi(scores=mock_scores)
    return SimpleNamespace(api=mock_api)


def _make_langfuse_client_paginated(pages: list[list[SimpleNamespace]]) -> SimpleNamespace:
    """Create a mock Langfuse client with multiple pages of scores."""
    responses = []
    for i, page_data in enumerate(pages):
        responses.append(_make_api_response(page_data, total_pages=len(pages)))
    mock_scores = _MockScoresClient(responses=responses)
    mock_api = _MockApi(scores=mock_scores)
    return SimpleNamespace(api=mock_api)


# ---------------------------------------------------------------------------
# Core export — numeric scores
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresNumeric:
    def test_emits_one_event_per_score(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            _make_score(id="s1", name="faithfulness", value=0.85),
            _make_score(id="s2", name="relevance", value=0.92),
            _make_score(id="s3", name="coherence", value=0.78),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 3

    def test_event_structure(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            _make_score(
                id="s-xyz",
                name="faithfulness",
                value=0.85,
                data_type="NUMERIC",
                source=_ScoreSource.EVAL,
                trace_id="trace-abc",
                observation_id="obs-def",
                session_id="sess-ghi",
                config_id="cfg-jkl",
            ),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 1
        event = body[0]

        assert event["event.type"] == "gen_ai.evaluation.result"
        assert event["gen_ai.evaluation.name"] == "faithfulness"
        assert event["gen_ai.evaluation.score.value"] == pytest.approx(0.85)
        assert event["event.provider"] == "langfuse"
        assert event["langfuse.score_id"] == "s-xyz"
        assert event["langfuse.score_source"] == "EVAL"
        assert event["langfuse.data_type"] == "NUMERIC"
        # OTel field mapping
        assert event["trace_id"] == "trace-abc"
        assert event["span_id"] == "obs-def"
        # Preserved as langfuse.* extra
        assert event["langfuse.trace_id"] == "trace-abc"
        assert event["langfuse.observation_id"] == "obs-def"
        assert event["langfuse.session_id"] == "sess-ghi"
        assert event["langfuse.config_id"] == "cfg-jkl"

    def test_empty_scores_logs_warning(self, caplog):
        dt_client = DynatraceClient(dry_run=True)
        langfuse = _make_langfuse_client([])

        with caplog.at_level(logging.WARNING):
            export_langfuse_scores(langfuse, dt_client)

        assert "no langfuse scores found" in caplog.text.lower()


# ---------------------------------------------------------------------------
# Boolean scores
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresBoolean:
    def test_boolean_true(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            _make_score(
                name="is_relevant",
                value=1.0,
                data_type="BOOLEAN",
                string_value="True",
            ),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        event = body[0]
        assert event["gen_ai.evaluation.score.value"] == 1.0
        assert event["gen_ai.evaluation.score.label"] == "True"

    def test_boolean_false(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            _make_score(
                name="is_relevant",
                value=0.0,
                data_type="BOOLEAN",
                string_value="False",
            ),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        event = body[0]
        assert event["gen_ai.evaluation.score.value"] == 0.0
        assert event["gen_ai.evaluation.score.label"] == "False"


# ---------------------------------------------------------------------------
# Categorical scores
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresCategorical:
    def test_categorical_with_numeric_mapping(self, httpx_mock):
        """Categorical scores with config have a numeric value (mapping)."""
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            _make_score(
                name="quality",
                value=2.0,
                data_type="CATEGORICAL",
                string_value="good",
            ),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        event = body[0]
        assert event["gen_ai.evaluation.name"] == "quality"
        assert event["gen_ai.evaluation.score.value"] == 2.0
        assert event["gen_ai.evaluation.score.label"] == "good"
        assert event["langfuse.data_type"] == "CATEGORICAL"

    def test_categorical_no_numeric_value(self, httpx_mock):
        """Categorical score without config: value=None, only string_value."""
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            _make_score(
                name="sentiment",
                value=None,
                data_type="CATEGORICAL",
                string_value="positive",
            ),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        event = body[0]
        assert event["gen_ai.evaluation.name"] == "sentiment"
        assert "gen_ai.evaluation.score.value" not in event
        assert event["gen_ai.evaluation.score.label"] == "positive"


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresFiltering:
    def test_trace_id_filter(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score(trace_id="trace-123")]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client, trace_ids=["trace-123"])

        # Verify the API was called with the trace_id filter
        calls = langfuse.api.scores.calls
        assert len(calls) == 1
        assert calls[0]["trace_id"] == "trace-123"

    def test_multiple_trace_ids(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        s1 = _make_score(id="s1", name="f", trace_id="t1")
        s2 = _make_score(id="s2", name="r", trace_id="t2")
        # Two separate API calls, one per trace_id
        resp1 = _make_api_response([s1])
        resp2 = _make_api_response([s2])
        mock_scores = _MockScoresClient(responses=[resp1, resp2])
        mock_api = _MockApi(scores=mock_scores)
        langfuse = SimpleNamespace(api=mock_api)

        export_langfuse_scores(langfuse, dt_client, trace_ids=["t1", "t2"])

        calls = langfuse.api.scores.calls
        assert len(calls) == 2
        assert calls[0]["trace_id"] == "t1"
        assert calls[1]["trace_id"] == "t2"

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 2

    def test_score_name_filter(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score(name="faithfulness")]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client, score_name="faithfulness")

        calls = langfuse.api.scores.calls
        assert calls[0]["name"] == "faithfulness"


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresPagination:
    def test_paginates_across_pages(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        page1 = [_make_score(id=f"s{i}", name=f"metric_{i}") for i in range(3)]
        page2 = [_make_score(id=f"s{i}", name=f"metric_{i}") for i in range(3, 5)]
        langfuse = _make_langfuse_client_paginated([page1, page2])

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 5

        calls = langfuse.api.scores.calls
        assert len(calls) == 2
        assert calls[0]["page"] == 1
        assert calls[1]["page"] == 2


# ---------------------------------------------------------------------------
# Comments / PII
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresComments:
    def test_comments_excluded_by_default(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score(comment="The answer was factually correct")]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        assert "langfuse.score_comment" not in body[0]

    def test_comments_included_when_opted_in(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score(comment="The answer was factually correct")]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client, include_comments=True)

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["langfuse.score_comment"] == "The answer was factually correct"


# ---------------------------------------------------------------------------
# Extra / kwargs forwarding
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresExtras:
    def test_extra_merged(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score()]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client, extra={"custom.team": "ml-platform"})

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["custom.team"] == "ml-platform"
        assert body[0]["event.provider"] == "langfuse"

    def test_eval_kwargs_forwarded(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score()]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(
            langfuse,
            dt_client,
            eval_method="llm_as_judge",
            scoring_format="score_0_to_1",
        )

        body = json.loads(httpx_mock.get_request().content)
        assert body[0]["gen_ai.evaluation.method"] == "llm_as_judge"
        assert body[0]["gen_ai.evaluation.scoring_format"] == "score_0_to_1"

    def test_dry_run_logs_events(self, caplog):
        dt_client = DynatraceClient(dry_run=True)
        scores = [_make_score()]
        langfuse = _make_langfuse_client(scores)

        with caplog.at_level(logging.INFO):
            export_langfuse_scores(langfuse, dt_client)

        assert "[dry-run]" in caplog.text


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresEdgeCases:
    def test_score_without_trace_id(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score(trace_id=None, observation_id=None)]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        event = body[0]
        assert "trace_id" not in event
        assert "span_id" not in event
        assert "langfuse.trace_id" not in event
        assert "langfuse.observation_id" not in event

    def test_score_without_name_skipped(self, httpx_mock):
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            SimpleNamespace(
                id="s-bad",
                name=None,
                value=0.5,
                data_type="NUMERIC",
                source=_ScoreSource.API,
                trace_id=None,
                observation_id=None,
                session_id=None,
                config_id=None,
                comment=None,
                string_value=None,
            ),
            _make_score(id="s-good", name="valid", value=0.9),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(langfuse, dt_client)

        body = json.loads(httpx_mock.get_request().content)
        assert len(body) == 1
        assert body[0]["gen_ai.evaluation.name"] == "valid"

    def test_numeric_score_none_value_skipped(self, caplog):
        dt_client = DynatraceClient(dry_run=True)
        scores = [_make_score(value=None)]
        langfuse = _make_langfuse_client(scores)

        with caplog.at_level(logging.DEBUG):
            export_langfuse_scores(langfuse, dt_client)

        # Score was skipped — no events
        assert "skipping score" in caplog.text.lower() or "no valid scores" in caplog.text.lower()


# ---------------------------------------------------------------------------
# Integration
# ---------------------------------------------------------------------------


class TestExportLangfuseScoresIntegration:
    def test_full_flow(self, httpx_mock):
        """Full flow: mock scores → export → verify HTTP request."""
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [
            _make_score(
                id="s1",
                name="faithfulness",
                value=0.91,
                trace_id="trace-001",
                source=_ScoreSource.EVAL,
            ),
            _make_score(
                id="s2",
                name="relevance",
                value=0.78,
                trace_id="trace-001",
                observation_id="obs-abc",
                source=_ScoreSource.API,
            ),
            _make_score(
                id="s3",
                name="is_correct",
                value=1.0,
                data_type="BOOLEAN",
                string_value="True",
                trace_id="trace-002",
                source=_ScoreSource.ANNOTATION,
            ),
        ]
        langfuse = _make_langfuse_client(scores)

        export_langfuse_scores(
            langfuse,
            dt_client,
            eval_method="llm_as_judge",
        )

        request = httpx_mock.get_request()
        body = json.loads(request.content)

        assert len(body) == 3

        for event in body:
            assert event["event.type"] == "gen_ai.evaluation.result"
            assert event["event.provider"] == "langfuse"
            assert event["gen_ai.evaluation.method"] == "llm_as_judge"

        # Check specific scores
        by_name = {e["gen_ai.evaluation.name"]: e for e in body}
        assert by_name["faithfulness"]["gen_ai.evaluation.score.value"] == pytest.approx(0.91)
        assert by_name["is_correct"]["gen_ai.evaluation.score.label"] == "True"

    def test_export_works_in_running_loop(self, httpx_mock):
        """Simulate Jupyter: call from inside a running event loop."""
        dt_client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        scores = [_make_score()]
        langfuse = _make_langfuse_client(scores)

        async def _wrapper():
            export_langfuse_scores(langfuse, dt_client)

        asyncio.run(_wrapper())

        requests = httpx_mock.get_requests()
        assert len(requests) == 1
