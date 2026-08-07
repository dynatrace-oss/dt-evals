"""Tests for DynatraceClient: env config, dry-run, and BizEvents egress."""

from __future__ import annotations

import json

import pytest

from dt_ai_ingest import DynatraceClient, Eval


async def test_dry_run_counts_without_network():
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com", token="dt0c01.x", dry_run=True
    )
    assert await client.ingest([Eval(name="a", score=1.0), {"name": "b", "score": 0.0}]) == 2


def test_env_config(monkeypatch):
    monkeypatch.setenv("DT_ENDPOINT", "https://env.live.dynatrace.com")
    monkeypatch.setenv("DT_API_TOKEN", "dt0c01.env")
    client = DynatraceClient()
    assert client.endpoint == "https://env.live.dynatrace.com"
    assert client.token == "dt0c01.env"


def test_legacy_env_fallback(monkeypatch):
    monkeypatch.delenv("DT_ENDPOINT", raising=False)
    monkeypatch.delenv("DT_API_TOKEN", raising=False)
    monkeypatch.setenv("DT_TENANT_URL", "https://legacy.live.dynatrace.com")
    monkeypatch.setenv("DT_ACCESS_TOKEN", "dt0c01.legacy")
    client = DynatraceClient()
    assert client.endpoint == "https://legacy.live.dynatrace.com"
    assert client.token == "dt0c01.legacy"


async def test_missing_credentials_raises(monkeypatch):
    for var in ("DT_ENDPOINT", "DT_TENANT_URL", "DT_API_TOKEN", "DT_ACCESS_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    client = DynatraceClient(dry_run=False)
    with pytest.raises(ValueError, match="endpoint"):
        await client.ingest([Eval(name="a")])


async def test_ingest_posts_bizevents(httpx_mock):
    httpx_mock.add_response()
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com", token="dt0c01.x", dry_run=False
    )
    assert await client.ingest([Eval(name="faith", score=1.0)]) == 1

    requests = httpx_mock.get_requests()
    assert len(requests) == 1
    assert requests[0].url.path == "/api/v2/bizevents/ingest"
    body = json.loads(requests[0].content)
    assert body[0]["event.type"] == "gen_ai.evaluation.result"
    assert body[0]["gen_ai.evaluation.score.value"] == 1.0
