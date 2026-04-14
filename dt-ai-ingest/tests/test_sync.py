"""Tests for dt_ai_ingest._sync — sync/async bridge (CORE-06)."""

from __future__ import annotations

import asyncio

import pytest

from dt_ai_ingest._sync import run_sync


async def _async_add(a: int, b: int) -> int:
    """Trivial async helper for testing."""
    return a + b


async def _async_fail() -> None:
    """Async helper that raises ValueError."""
    raise ValueError("expected error")


class TestRunSync:
    def test_no_event_loop(self):
        result = run_sync(_async_add(2, 3))
        assert result == 5

    def test_with_running_loop(self):
        """Simulate Jupyter by calling run_sync from inside a running loop."""

        async def _wrapper() -> int:
            return run_sync(_async_add(10, 20))

        result = asyncio.run(_wrapper())
        assert result == 30

    def test_propagates_exception(self):
        with pytest.raises(ValueError, match="expected error"):
            run_sync(_async_fail())

    def test_propagates_exception_from_running_loop(self):
        async def _wrapper() -> None:
            run_sync(_async_fail())

        with pytest.raises(ValueError, match="expected error"):
            asyncio.run(_wrapper())

    def test_with_async_client_send(self, httpx_mock):
        """End-to-end: run_sync with DynatraceClient from inside a running loop."""
        from dt_ai_ingest.client import DynatraceClient

        httpx_mock.add_response(status_code=204)

        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )

        async def _wrapper() -> None:
            run_sync(client.send_bizevents([{"event.type": "test"}]))

        asyncio.run(_wrapper())

        requests = httpx_mock.get_requests()
        assert len(requests) == 1

    def test_consecutive_run_sync_calls(self, httpx_mock):
        """Consecutive run_sync() calls must not crash with 'Event loop is closed'.

        Regression test: asyncio.run() closes the event loop it creates.
        If the httpx.AsyncClient survives across calls, its pooled connections
        reference the dead loop and the second call raises RuntimeError.
        """
        from dt_ai_ingest.client import DynatraceClient

        httpx_mock.add_response(status_code=204)
        httpx_mock.add_response(status_code=204)
        httpx_mock.add_response(status_code=204)

        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )

        # Three consecutive calls — the second and third would crash without the fix.
        run_sync(client.send_bizevents([{"event.type": "call-1"}]))
        run_sync(client.send_bizevents([{"event.type": "call-2"}]))
        run_sync(client.send_bizevents([{"event.type": "call-3"}]))

        requests = httpx_mock.get_requests()
        assert len(requests) == 3

    def test_consecutive_export_calls(self, httpx_mock):
        """End-to-end: consecutive export() calls via the unified API."""
        from types import SimpleNamespace

        from dt_ai_ingest.client import DynatraceClient

        httpx_mock.add_response(status_code=204)
        httpx_mock.add_response(status_code=204)

        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )

        result1 = SimpleNamespace(metrics={"score_a/mean": 0.9})
        result2 = SimpleNamespace(metrics={"score_b/mean": 0.8})

        client.export(result1, experiment="test")
        client.export(result2, experiment="test")

        requests = httpx_mock.get_requests()
        assert len(requests) == 2
