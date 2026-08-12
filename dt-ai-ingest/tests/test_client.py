"""Tests for DynatraceClient: env config, dry-run, and BizEvents egress."""

from __future__ import annotations

import asyncio
import json
import threading

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
        await client.ingest([Eval(name="a", score=0.5)])


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


async def test_ingest_file_streams_in_batches(tmp_path, httpx_mock):
    path = tmp_path / "scores.csv"
    path.write_text("name,score\na,0.1\nb,0.2\nc,0.3\n")
    httpx_mock.add_response()
    httpx_mock.add_response()
    httpx_mock.add_response()
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com",
        token="dt0c01.x",
        dry_run=False,
        chunk_size=1,
    )

    total = await client.ingest_file(str(path))

    assert total == 3
    assert len(httpx_mock.get_requests()) == 3


async def test_ingest_file_dry_run_counts_without_network(tmp_path):
    path = tmp_path / "scores.csv"
    path.write_text("name,score\na,0.1\nb,0.2\n")
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com", token="dt0c01.x", dry_run=True
    )

    assert await client.ingest_file(str(path)) == 2


async def test_ingest_file_shares_run_id(tmp_path, httpx_mock):
    path = tmp_path / "scores.csv"
    path.write_text("name,score\na,0.1\nb,0.2\n")
    httpx_mock.add_response()
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com", token="dt0c01.x", dry_run=False
    )

    await client.ingest_file(str(path), run_id="golden-set-v1")

    body = json.loads(httpx_mock.get_requests()[0].content)
    assert {row["dt.eval.run_id"] for row in body} == {"golden-set-v1"}


async def test_ingest_file_run_id_overrides_file_column(tmp_path, httpx_mock):
    """A file that carries its own `run_id` column must not override the
    batch-wide run_id passed to ingest_file() — every row in one call shares
    the same run_id regardless of file content.
    """
    path = tmp_path / "scores.csv"
    path.write_text("name,score,run_id\na,0.1,old-run\nb,0.2,old-run\n")
    httpx_mock.add_response()
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com", token="dt0c01.x", dry_run=False
    )

    await client.ingest_file(str(path), run_id="golden-set-v1")

    body = json.loads(httpx_mock.get_requests()[0].content)
    assert {row["dt.eval.run_id"] for row in body} == {"golden-set-v1"}


async def test_ingest_file_auto_run_id_is_consistent(tmp_path, httpx_mock):
    """When run_id isn't supplied, an auto-generated UUID is stamped on every
    row — all rows in the same call share the same UUID.
    """
    path = tmp_path / "scores.csv"
    path.write_text("name,score\na,0.1\nb,0.2\n")
    httpx_mock.add_response()
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com", token="dt0c01.x", dry_run=False
    )

    await client.ingest_file(str(path))

    body = json.loads(httpx_mock.get_requests()[0].content)
    run_ids = {row["dt.eval.run_id"] for row in body}
    assert len(run_ids) == 1


async def test_ingest_file_missing_file_raises(tmp_path):
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com", token="dt0c01.x", dry_run=True
    )

    with pytest.raises(FileNotFoundError):
        await client.ingest_file(str(tmp_path / "missing.csv"))


async def test_ingest_file_mid_stream_failure_does_not_deadlock(tmp_path):
    """Regression test: a failing ingest() used to leave the producer thread
    blocked forever on a full queue, hanging the whole event loop (not just
    this task) instead of propagating the error.
    """
    path = tmp_path / "scores.csv"
    rows = "\n".join(f"e{i},0.1" for i in range(10))
    path.write_text(f"name,score\n{rows}\n")
    client = DynatraceClient(
        endpoint="https://t.live.dynatrace.com",
        token="dt0c01.x",
        chunk_size=1,
    )
    calls = 0

    # `ingest()` is fully replaced, so `dry_run` is irrelevant here — this
    # only exercises ingest_file()'s producer/consumer plumbing, not egress.
    async def failing_ingest(evals):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("boom")
        return len(evals)

    client.ingest = failing_ingest

    with pytest.raises(RuntimeError, match="boom"):
        await asyncio.wait_for(client.ingest_file(str(path)), timeout=5)

    # ingest_file's `finally` awaits producer.join(), so by the time the
    # exception surfaces the background reader thread must already be gone.
    assert not any(t.name == "dt-ai-ingest-file-reader" for t in threading.enumerate())
