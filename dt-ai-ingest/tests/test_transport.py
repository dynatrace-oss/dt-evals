"""Tests for Transport: retry/backoff, chunking, and partial-failure behavior."""

from __future__ import annotations

import httpx
import pytest

from dt_ai_ingest._transport import Transport


async def test_retries_on_503_then_succeeds(httpx_mock):
    httpx_mock.add_response(status_code=503)
    httpx_mock.add_response(status_code=200, json={})
    transport = Transport("https://t.live.dynatrace.com", "dt0c01.x", max_retries=2)

    await transport.send([{"name": "a"}])

    assert len(httpx_mock.get_requests()) == 2


async def test_gives_up_after_max_retries(httpx_mock):
    httpx_mock.add_response(status_code=503)
    httpx_mock.add_response(status_code=503)
    transport = Transport("https://t.live.dynatrace.com", "dt0c01.x", max_retries=2)

    with pytest.raises(httpx.HTTPStatusError):
        await transport.send([{"name": "a"}])

    assert len(httpx_mock.get_requests()) == 2


async def test_respects_retry_after_header(httpx_mock):
    httpx_mock.add_response(status_code=429, headers={"Retry-After": "0"})
    httpx_mock.add_response(status_code=200, json={})
    transport = Transport("https://t.live.dynatrace.com", "dt0c01.x", max_retries=2)

    await transport.send([{"name": "a"}])

    assert len(httpx_mock.get_requests()) == 2


async def test_non_retryable_status_raises_immediately(httpx_mock):
    httpx_mock.add_response(status_code=400)
    transport = Transport("https://t.live.dynatrace.com", "dt0c01.x", max_retries=3)

    with pytest.raises(httpx.HTTPStatusError):
        await transport.send([{"name": "a"}])

    assert len(httpx_mock.get_requests()) == 1


async def test_chunks_large_batches(httpx_mock):
    httpx_mock.add_response(status_code=200, json={})
    httpx_mock.add_response(status_code=200, json={})
    transport = Transport("https://t.live.dynatrace.com", "dt0c01.x", chunk_size=1)

    await transport.send([{"name": "a"}, {"name": "b"}])

    requests = httpx_mock.get_requests()
    assert len(requests) == 2


async def test_empty_batch_sends_nothing(httpx_mock):
    transport = Transport("https://t.live.dynatrace.com", "dt0c01.x")

    await transport.send([])

    assert httpx_mock.get_requests() == []
