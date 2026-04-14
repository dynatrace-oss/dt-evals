"""Tests for dt_ai_ingest.client."""

import json
import logging

import httpx
import pytest

from dt_ai_ingest.client import DynatraceClient, _bizevents_path
from dt_ai_ingest.schema import EvalEvent


class TestBizeventsPath:
    def test_classic_saas(self):
        assert _bizevents_path("https://abc.live.dynatrace.com") == "/api/v2/bizevents/ingest"

    def test_classic_managed(self):
        assert _bizevents_path("https://my-dt.internal.com") == "/api/v2/bizevents/ingest"

    def test_platform_apps_with_bearer_token(self):
        path = _bizevents_path("https://abc.apps.dynatrace.com", "eyJtoken")
        assert path == "/platform/classic/environment-api/v2/bizevents/ingest"

    def test_platform_labs_with_bearer_token(self):
        path = _bizevents_path("https://abc.apps.dynatracelabs.com", "eyJtoken")
        assert path == "/platform/classic/environment-api/v2/bizevents/ingest"

    def test_platform_url_with_classic_token_falls_back(self):
        """Classic token + platform URL → classic path (avoids auth scheme mismatch)."""
        path = _bizevents_path("https://abc.apps.dynatrace.com", "dt0c01.test.secret")
        assert path == "/api/v2/bizevents/ingest"

    def test_platform_url_with_classic_saas_token_falls_back(self):
        path = _bizevents_path("https://abc.apps.dynatracelabs.com", "dt0s01.test.secret")
        assert path == "/api/v2/bizevents/ingest"

    def test_platform_url_no_token_uses_platform_path(self):
        """No token provided → platform path (assumed bearer/OAuth token later)."""
        path = _bizevents_path("https://abc.apps.dynatrace.com")
        assert path == "/platform/classic/environment-api/v2/bizevents/ingest"


class TestDynatraceClientInit:
    def test_defaults(self, monkeypatch):
        monkeypatch.delenv("DT_TENANT_URL", raising=False)
        monkeypatch.delenv("DT_ACCESS_TOKEN", raising=False)
        client = DynatraceClient()
        assert client.tenant_url == ""
        assert client.access_token == ""
        assert client.dry_run is True

    def test_explicit_params(self):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com/",
            access_token="dt0c01.test",
            dry_run=False,
        )
        assert client.tenant_url == "https://test.live.dynatrace.com"
        assert client.access_token == "dt0c01.test"
        assert client.dry_run is False

    def test_env_fallback(self, monkeypatch):
        monkeypatch.setenv("DT_TENANT_URL", "https://env.live.dynatrace.com")
        monkeypatch.setenv("DT_ACCESS_TOKEN", "dt0c01.from-env")

        client = DynatraceClient()
        assert client.tenant_url == "https://env.live.dynatrace.com"
        assert client.access_token == "dt0c01.from-env"


class TestDynatraceClientDryRun:
    @pytest.mark.asyncio
    async def test_send_dry_run_logs(self, caplog):
        client = DynatraceClient(dry_run=True)
        event = EvalEvent(evaluation_name="test", scoring_format="score_0_to_1", score_value=0.5)

        with caplog.at_level(logging.INFO):
            await client.send(event)

        assert "[dry-run]" in caplog.text

    @pytest.mark.asyncio
    async def test_send_bizevents_dry_run_logs(self, caplog):
        client = DynatraceClient(dry_run=True)
        events = [{"event.type": "gen_ai.evaluation.result", "gen_ai.evaluation.name": "test"}]

        with caplog.at_level(logging.INFO):
            await client.send_bizevents(events)

        assert "[dry-run]" in caplog.text


class TestDynatraceClientValidation:
    @pytest.mark.asyncio
    async def test_send_no_tenant_url_raises(self, monkeypatch):
        monkeypatch.delenv("DT_TENANT_URL", raising=False)
        monkeypatch.delenv("DT_ACCESS_TOKEN", raising=False)
        client = DynatraceClient(access_token="dt0c01.test", dry_run=False)

        with pytest.raises(ValueError, match="Tenant URL"):
            await client.send_bizevents([{"event.type": "test"}])

    @pytest.mark.asyncio
    async def test_send_no_token_raises(self, monkeypatch):
        monkeypatch.delenv("DT_TENANT_URL", raising=False)
        monkeypatch.delenv("DT_ACCESS_TOKEN", raising=False)
        client = DynatraceClient(tenant_url="https://test.live.dynatrace.com", dry_run=False)

        with pytest.raises(ValueError, match="access token"):
            await client.send_bizevents([{"event.type": "test"}])


class TestDynatraceClientSend:
    @pytest.mark.asyncio
    async def test_send_bizevents_posts_to_endpoint(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        events = [
            {
                "event.type": "gen_ai.evaluation.result",
                "gen_ai.evaluation.name": "exact_match",
                "gen_ai.evaluation.score.value": 0.85,
            }
        ]
        await client.send_bizevents(events)

        request = httpx_mock.get_request()
        assert request.url == "https://test.live.dynatrace.com/api/v2/bizevents/ingest"
        assert request.headers["Authorization"] == "Api-Token dt0c01.test"
        assert request.headers["Content-Type"] == "application/json"

        body = json.loads(request.content)
        assert body[0]["gen_ai.evaluation.name"] == "exact_match"

    @pytest.mark.asyncio
    async def test_send_eval_event(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        event = EvalEvent(
            evaluation_name="faithfulness",
            scoring_format="score_0_to_1",
            score_value=0.9,
        )
        await client.send(event)

        request = httpx_mock.get_request()
        body = json.loads(request.content)
        assert body["gen_ai.evaluation.name"] == "faithfulness"
        assert body["gen_ai.evaluation.score.value"] == 0.9

    @pytest.mark.asyncio
    async def test_send_to_platform_url(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://abc.apps.dynatrace.com",
            access_token="eyJtoken",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        request = httpx_mock.get_request()
        assert "/platform/classic/environment-api/v2/bizevents/ingest" in str(request.url)
        assert request.headers["Authorization"] == "Bearer eyJtoken"


# ──────────────────────────────────────────────────────────────
# New test classes for Plan 01-01
# ──────────────────────────────────────────────────────────────


class TestDynatraceClientLifecycle:
    """Tests for persistent client pooling and lifecycle (CORE-02)."""

    def test_lazy_client_creation(self):
        client = DynatraceClient()
        assert client._owned_client is None

    def test_client_created_on_first_http_access(self):
        client = DynatraceClient()
        http = client._http
        assert http is not None
        assert client._owned_client is http

    def test_client_reuse_across_accesses(self):
        client = DynatraceClient()
        first = client._http
        second = client._http
        assert first is second

    @pytest.mark.asyncio
    async def test_client_reuse_across_send_calls(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])
        http_after_first = client._owned_client

        await client.send_bizevents([{"event.type": "test2"}])
        http_after_second = client._owned_client

        assert http_after_first is http_after_second

    def test_external_client_used_when_provided(self):
        ext = httpx.AsyncClient()
        client = DynatraceClient(http_client=ext)
        assert client._http is ext
        assert client._owned_client is None

    @pytest.mark.asyncio
    async def test_close_closes_owned_client(self):
        client = DynatraceClient()
        _ = client._http  # trigger creation
        assert client._owned_client is not None

        await client.close()
        assert client._owned_client is None

    @pytest.mark.asyncio
    async def test_close_does_not_close_external_client(self):
        ext = httpx.AsyncClient()
        client = DynatraceClient(http_client=ext)

        await client.close()
        assert not ext.is_closed
        await ext.aclose()

    @pytest.mark.asyncio
    async def test_async_context_manager(self):
        async with DynatraceClient() as client:
            _ = client._http
            assert client._owned_client is not None

        assert client._owned_client is None


class TestDynatraceClientRetry:
    """Tests for retry logic with exponential backoff (CORE-01)."""

    @pytest.mark.asyncio
    async def test_retry_on_503_succeeds(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            max_retries=3,
        )
        httpx_mock.add_response(status_code=503)
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        requests = httpx_mock.get_requests()
        assert len(requests) == 2

    @pytest.mark.asyncio
    async def test_retry_on_429_respects_retry_after(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            max_retries=3,
        )
        httpx_mock.add_response(status_code=429, headers={"Retry-After": "0.01"})
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        requests = httpx_mock.get_requests()
        assert len(requests) == 2

    @pytest.mark.asyncio
    async def test_retry_on_502(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            max_retries=2,
        )
        httpx_mock.add_response(status_code=502)
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        requests = httpx_mock.get_requests()
        assert len(requests) == 2

    @pytest.mark.asyncio
    async def test_retry_on_504(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            max_retries=2,
        )
        httpx_mock.add_response(status_code=504)
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        requests = httpx_mock.get_requests()
        assert len(requests) == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_400(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            max_retries=3,
        )
        httpx_mock.add_response(status_code=400)

        with pytest.raises(httpx.HTTPStatusError):
            await client.send_bizevents([{"event.type": "test"}])

        requests = httpx_mock.get_requests()
        assert len(requests) == 1

    @pytest.mark.asyncio
    async def test_exhausted_retries_raises(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            max_retries=2,
        )
        httpx_mock.add_response(status_code=503)
        httpx_mock.add_response(status_code=503)

        with pytest.raises(httpx.HTTPStatusError):
            await client.send_bizevents([{"event.type": "test"}])

        requests = httpx_mock.get_requests()
        assert len(requests) == 2

    @pytest.mark.asyncio
    async def test_retry_on_connection_error(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            max_retries=2,
        )
        httpx_mock.add_exception(httpx.ConnectError("Connection refused"))
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        requests = httpx_mock.get_requests()
        assert len(requests) == 2


class TestDynatraceClientChunking:
    """Tests for batch chunking (CORE-04)."""

    def test_chunk_size_default_100(self):
        client = DynatraceClient()
        assert client.chunk_size == 100

    def test_custom_chunk_size(self):
        client = DynatraceClient(chunk_size=50)
        assert client.chunk_size == 50

    @pytest.mark.asyncio
    async def test_150_events_sends_two_requests(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            chunk_size=100,
        )
        httpx_mock.add_response(status_code=204)
        httpx_mock.add_response(status_code=204)

        events = [{"event.type": f"test-{i}"} for i in range(150)]
        await client.send_bizevents(events)

        requests = httpx_mock.get_requests()
        assert len(requests) == 2

        body_0 = json.loads(requests[0].content)
        body_1 = json.loads(requests[1].content)
        assert len(body_0) == 100
        assert len(body_1) == 50

    @pytest.mark.asyncio
    async def test_single_chunk_no_extra_requests(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            chunk_size=100,
        )
        httpx_mock.add_response(status_code=204)

        events = [{"event.type": f"test-{i}"} for i in range(50)]
        await client.send_bizevents(events)

        requests = httpx_mock.get_requests()
        assert len(requests) == 1

    @pytest.mark.asyncio
    async def test_500_events_chunked_correctly(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
            chunk_size=100,
        )
        for _ in range(5):
            httpx_mock.add_response(status_code=204)

        events = [{"event.type": f"test-{i}"} for i in range(500)]
        await client.send_bizevents(events)

        requests = httpx_mock.get_requests()
        assert len(requests) == 5

        for req in requests:
            body = json.loads(req.content)
            assert len(body) == 100

    @pytest.mark.asyncio
    async def test_empty_events_no_requests(self, httpx_mock):
        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
            dry_run=False,
        )

        await client.send_bizevents([])

        requests = httpx_mock.get_requests()
        assert len(requests) == 0


class TestDynatraceClientTimeout:
    """Tests for configurable timeout (CORE-03)."""

    def test_default_timeout_30(self):
        client = DynatraceClient()
        assert client.timeout == 30.0

    def test_custom_timeout(self):
        client = DynatraceClient(timeout=60.0)
        assert client.timeout == 60.0
        # Verify the httpx client respects it
        http = client._http
        assert http.timeout.connect == 60.0
        assert http.timeout.read == 60.0


class TestDynatraceClientWhitespace:
    """Tests for leading/trailing whitespace in tenant_url and access_token."""

    def test_tenant_url_strips_leading_whitespace(self):
        client = DynatraceClient(tenant_url="  https://test.live.dynatrace.com")
        assert client.tenant_url == "https://test.live.dynatrace.com"

    def test_tenant_url_strips_trailing_whitespace(self):
        client = DynatraceClient(tenant_url="https://test.live.dynatrace.com  ")
        assert client.tenant_url == "https://test.live.dynatrace.com"

    def test_access_token_strips_whitespace(self):
        client = DynatraceClient(access_token="  dt0c01.test  ")
        assert client.access_token == "dt0c01.test"

    def test_env_var_whitespace_stripped(self, monkeypatch):
        monkeypatch.setenv("DT_TENANT_URL", "  https://env.live.dynatrace.com  ")
        monkeypatch.setenv("DT_ACCESS_TOKEN", "  dt0c01.from-env  ")
        client = DynatraceClient()
        assert client.tenant_url == "https://env.live.dynatrace.com"
        assert client.access_token == "dt0c01.from-env"


class TestPlatformUrlClassicTokenFallback:
    """Tests for platform URL + classic token auth-scheme mismatch (Bug 2)."""

    @pytest.mark.asyncio
    async def test_platform_url_classic_token_uses_classic_path(self, httpx_mock):
        """Classic token + platform URL → falls back to classic API path."""
        client = DynatraceClient(
            tenant_url="https://abc.apps.dynatrace.com",
            access_token="dt0c01.test.secret",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        request = httpx_mock.get_request()
        assert "/api/v2/bizevents/ingest" in str(request.url)
        assert "/platform/classic/" not in str(request.url)
        assert request.headers["Authorization"] == "Api-Token dt0c01.test.secret"

    @pytest.mark.asyncio
    async def test_platform_url_bearer_token_uses_platform_path(self, httpx_mock):
        """Bearer token + platform URL → uses platform API path."""
        client = DynatraceClient(
            tenant_url="https://abc.apps.dynatrace.com",
            access_token="eyJtoken",
            dry_run=False,
        )
        httpx_mock.add_response(status_code=204)

        await client.send_bizevents([{"event.type": "test"}])

        request = httpx_mock.get_request()
        assert "/platform/classic/environment-api/v2/bizevents/ingest" in str(request.url)
        assert request.headers["Authorization"] == "Bearer eyJtoken"
