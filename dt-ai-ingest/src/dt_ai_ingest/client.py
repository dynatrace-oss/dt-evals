"""Dynatrace BizEvents async HTTP client."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from typing import TYPE_CHECKING, Any

import httpx

from dt_ai_ingest.auth import is_classic_token, make_auth_header

if TYPE_CHECKING:
    from opentelemetry.sdk.trace import TracerProvider

    from dt_ai_ingest.schema import EvalEvent

logger = logging.getLogger(__name__)

_BIZEVENTS_PATH_CLASSIC = "/api/v2/bizevents/ingest"
_BIZEVENTS_PATH_PLATFORM = "/platform/classic/environment-api/v2/bizevents/ingest"

# Substrings that identify Dynatrace Platform (next-gen) tenant URLs.
_PLATFORM_URL_MARKERS = (".apps.dynatrace.com", ".apps.dynatracelabs.com")

_RETRYABLE_STATUS_CODES = frozenset({429, 502, 503, 504})
_BASE_BACKOFF_SECONDS = 1.0
_MAX_BACKOFF_SECONDS = 60.0
_MAX_CONCURRENT_CHUNKS = 5


def _bizevents_path(tenant_url: str, access_token: str = "") -> str:
    """Return the correct BizEvents ingest path for *tenant_url*.

    When a platform-style URL (``*.apps.dynatrace.com``) is combined with a
    classic API token (``dt0c01.*``, etc.) the platform endpoint would reject
    the ``Api-Token`` scheme.  In that case fall back to the classic API path
    which the platform still proxies under ``/api/v2/...``.
    """
    is_platform_url = any(marker in tenant_url for marker in _PLATFORM_URL_MARKERS)
    if is_platform_url and not is_classic_token(access_token):
        return _BIZEVENTS_PATH_PLATFORM
    return _BIZEVENTS_PATH_CLASSIC


class DynatraceClient:
    """Async HTTP client that ships BizEvents to Dynatrace Grail.

    Uses a single Dynatrace access token for both BizEvents and OTLP
    endpoints. Token type (classic API-Token vs Bearer) is auto-detected.

    The client lazily creates a persistent ``httpx.AsyncClient`` on first
    use.  Use :meth:`close` (or the ``async with`` context manager) to
    release the connection when you are done.

    Args:
        tenant_url:    Base URL, e.g. ``https://abc.live.dynatrace.com``
                       or ``https://abc.apps.dynatrace.com``.
        access_token:  DT access token. Falls back to ``DT_ACCESS_TOKEN`` env var.
        dry_run:       When ``True`` events are only logged — no HTTP calls.
        timeout:       HTTP request timeout in seconds.
        chunk_size:    Maximum number of events per HTTP POST.
        max_retries:   Number of attempts for retryable errors.
        http_client:   Optional external ``httpx.AsyncClient`` — when provided,
                       the client will use it instead of creating its own.
    """

    def __init__(
        self,
        tenant_url: str | None = None,
        access_token: str | None = None,
        *,
        dry_run: bool = True,
        timeout: float = 30.0,
        chunk_size: int = 100,
        max_retries: int = 3,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.tenant_url = (tenant_url or os.environ.get("DT_TENANT_URL", "")).strip().rstrip("/")
        self.access_token = (access_token or os.environ.get("DT_ACCESS_TOKEN", "")).strip()
        self.dry_run = dry_run
        self.timeout = timeout
        self.chunk_size = chunk_size
        self.max_retries = max_retries
        self._external_client = http_client
        self._owned_client: httpx.AsyncClient | None = None
        self._client_loop_id: int | None = None  # id() of the event loop that created _owned_client

    # ------------------------------------------------------------------
    # HTTP client lifecycle
    # ------------------------------------------------------------------

    @property
    def _http(self) -> httpx.AsyncClient:
        """Return the shared httpx client, creating one on first access.

        When a previous client was created under a different event loop
        (e.g. by a prior ``asyncio.run()`` call that has since closed),
        it is silently replaced so that pooled connections never reference
        a dead loop.
        """
        if self._external_client is not None:
            return self._external_client

        # Determine the current running loop (if any).
        current_loop_id: int | None = None
        try:
            current_loop_id = id(asyncio.get_running_loop())
        except RuntimeError:
            pass

        # If the owned client was created under a different loop, discard it.
        if (
            self._owned_client is not None
            and not self._owned_client.is_closed
            and self._client_loop_id is not None
            and current_loop_id is not None
            and current_loop_id != self._client_loop_id
        ):
            # Discard the stale client — its connections reference a dead loop
            # so we cannot await aclose() without risking a RuntimeError on the
            # closed loop.  We orphan the client and rely on CPython's reference-
            # counting GC to finalise the underlying socket.
            #
            # Trade-off: in long-lived processes or notebooks that call
            # asyncio.run() repeatedly, discarded clients accumulate until GC
            # collects them, which can briefly exhaust file descriptors under
            # high concurrency.
            #
            # Mitigation: callers that control the event-loop lifecycle should
            # use DynatraceClient as an async context manager (``async with``),
            # which calls aclose() before the loop shuts down and avoids the
            # orphan entirely.
            self._owned_client = None
            self._client_loop_id = None

        if self._owned_client is None or self._owned_client.is_closed:
            self._owned_client = httpx.AsyncClient(timeout=self.timeout)
            self._client_loop_id = current_loop_id
        return self._owned_client

    async def close(self) -> None:
        """Close the internal HTTP client (no-op if using an external client)."""
        if self._owned_client is not None and not self._owned_client.is_closed:
            await self._owned_client.aclose()
            self._owned_client = None
            self._client_loop_id = None

    async def __aenter__(self) -> DynatraceClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        await self.close()

    # ------------------------------------------------------------------
    # Endpoint / header helpers
    # ------------------------------------------------------------------

    @property
    def _endpoint(self) -> str:
        return f"{self.tenant_url}{_bizevents_path(self.tenant_url, self.access_token)}"

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": make_auth_header(self.access_token),
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # Retry logic
    # ------------------------------------------------------------------

    async def _request_with_retry(
        self,
        *,
        url: str,
        headers: dict[str, str],
        json_payload: Any,
    ) -> httpx.Response:
        """POST with retry on transient failures.

        Retries on 429 (respecting ``Retry-After``), 502, 503, 504.
        Uses exponential backoff with full jitter.
        """
        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = await self._http.post(url, headers=headers, json=json_payload)
                if response.status_code not in _RETRYABLE_STATUS_CODES:
                    response.raise_for_status()
                    return response
                # Retryable HTTP status
                if attempt == self.max_retries:
                    response.raise_for_status()
                    return response  # unreachable but satisfies type checker
                delay = self._backoff_delay(attempt, response)
                logger.warning(
                    "HTTP %s from %s (attempt %d/%d), retrying in %.1fs",
                    response.status_code,
                    url,
                    attempt,
                    self.max_retries,
                    delay,
                )
                await asyncio.sleep(delay)
            except httpx.HTTPStatusError:
                raise
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt == self.max_retries:
                    raise
                delay = self._backoff_delay(attempt)
                logger.warning(
                    "Request error: %s (attempt %d/%d), retrying in %.1fs",
                    exc,
                    attempt,
                    self.max_retries,
                    delay,
                )
                await asyncio.sleep(delay)
        # Should not reach here, but satisfy type checker
        assert last_exc is not None
        raise last_exc

    @staticmethod
    def _backoff_delay(attempt: int, response: httpx.Response | None = None) -> float:
        """Calculate backoff with jitter; respect Retry-After on 429."""
        if response is not None and response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            if retry_after is not None:
                try:
                    return float(retry_after)
                except ValueError:
                    pass
        cap = min(_BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)), _MAX_BACKOFF_SECONDS)
        return random.uniform(0, cap)  # noqa: S311

    # ------------------------------------------------------------------
    # Public send methods
    # ------------------------------------------------------------------

    async def send(self, event: EvalEvent) -> None:
        """Send a single ``EvalEvent`` to Grail."""
        payload = event.to_bizevents_payload()

        if self.dry_run:
            logger.info("[dry-run] BizEvent:\n%s", json.dumps(payload, indent=2))
            return

        self._validate_credentials()

        response = await self._request_with_retry(
            url=self._endpoint,
            headers=self._headers,
            json_payload=payload,
        )
        logger.debug("BizEvent sent → HTTP %s", response.status_code)

    async def send_bizevents(self, events: list[dict[str, Any]]) -> None:
        """Send a batch of flat BizEvent dicts to Grail.

        Events are chunked into groups of ``chunk_size`` and sent in parallel
        with bounded concurrency.
        """
        if not events:
            return

        if self.dry_run:
            logger.info(
                "[dry-run] BizEvents batch (%d):\n%s",
                len(events),
                json.dumps(events, indent=2),
            )
            return

        self._validate_credentials()

        chunks = [events[i : i + self.chunk_size] for i in range(0, len(events), self.chunk_size)]

        if len(chunks) == 1:
            await self._send_chunk(chunks[0])
            return

        sem = asyncio.Semaphore(_MAX_CONCURRENT_CHUNKS)

        async def _guarded(chunk: list[dict[str, Any]]) -> None:
            async with sem:
                await self._send_chunk(chunk)

        await asyncio.gather(*[_guarded(c) for c in chunks])

    async def _send_chunk(self, chunk: list[dict[str, Any]]) -> None:
        """Send a single chunk of BizEvents."""
        response = await self._request_with_retry(
            url=self._endpoint,
            headers=self._headers,
            json_payload=chunk,
        )
        logger.debug(
            "Chunk of %d BizEvents sent → HTTP %s",
            len(chunk),
            response.status_code,
        )

    def _validate_credentials(self) -> None:
        if not self.tenant_url:
            raise ValueError("Tenant URL is not set. Pass tenant_url= or set DT_TENANT_URL.")
        if not self.access_token:
            raise ValueError("No access token set. Pass access_token= or set DT_ACCESS_TOKEN.")

    # ------------------------------------------------------------------
    # Unified API
    # ------------------------------------------------------------------

    def export(self, result: Any, **kwargs: Any) -> None:
        """Export evaluation results to Dynatrace, auto-dispatching by type.

        Inspects the *result* object and delegates to the appropriate
        adapter export function:

        - **Ragas** ``EvaluationResult`` (has ``.scores``) →
          :func:`~dt_ai_ingest.ragas.evaluation.export_ragas_results`
        - **DeepEval** ``EvaluationResult`` (has ``.test_results``) →
          :func:`~dt_ai_ingest.deepeval.evaluation.export_deepeval_results`
        - **MLflow** ``EvaluationResult`` (has ``.metrics``) →
          :func:`~dt_ai_ingest.mlflow.evaluation.export_evaluation_results`
        - **Langfuse** client (has ``.api.scores``) →
          :func:`~dt_ai_ingest.langfuse.evaluation.export_langfuse_scores`

        Args:
            result:    Framework result object (or Langfuse client).
            **kwargs:  Forwarded to the adapter export function.
                       See each adapter's docstring for supported options.

        Raises:
            TypeError: If the result type cannot be identified.

        Example::

            from dt_ai_ingest import DynatraceClient

            dt = DynatraceClient(
                tenant_url="https://<env-id>.live.dynatrace.com",
                access_token="dt0c01.***",
            )

            # Works with any supported framework:
            dt.export(ragas_result, dataset_name="my-qa-dataset")
            dt.export(deepeval_result, test_run_name="my-eval")
            dt.export(mlflow_result, run_id="abc123")
            dt.export(langfuse_client, trace_ids=["trace-1"])
        """
        adapter = _detect_adapter(result)
        if adapter == "ragas":
            from dt_ai_ingest.ragas.evaluation import export_ragas_results

            export_ragas_results(result, self, **kwargs)
        elif adapter == "deepeval":
            from dt_ai_ingest.deepeval.evaluation import export_deepeval_results

            export_deepeval_results(result, self, **kwargs)
        elif adapter == "mlflow":
            from dt_ai_ingest.mlflow.evaluation import export_evaluation_results

            export_evaluation_results(result, self, **kwargs)
        elif adapter == "langfuse":
            from dt_ai_ingest.langfuse.evaluation import export_langfuse_scores

            export_langfuse_scores(result, self, **kwargs)
        else:
            raise TypeError(
                f"Cannot detect framework for result of type {type(result).__qualname__!r}. "
                "Expected a Ragas EvaluationResult (.scores), "
                "DeepEval EvaluationResult (.test_results), "
                "MLflow EvaluationResult (.metrics dict), "
                "or a Langfuse client (.api.scores)."
            )

    def configure_tracing(
        self,
        *,
        framework: str | None = None,
        service_name: str | None = None,
    ) -> TracerProvider:
        """Configure OTel tracing to export spans to Dynatrace.

        Sets up a global ``TracerProvider`` with a Dynatrace OTLP exporter
        using this client's ``tenant_url`` and ``access_token``.

        Args:
            framework:     Optional framework hint: ``"mlflow"`` or ``"langfuse"``.
                           When ``"mlflow"``, also sets the env var needed to
                           make MLflow use the global TracerProvider and
                           registers an ``atexit`` flush handler.
                           When ``None``, performs plain OTel setup.
            service_name:  ``service.name`` resource attribute. Defaults to
                           ``"mlflow-eval"`` for MLflow, ``"langfuse-eval"``
                           for Langfuse, or ``"dt-ai-ingest"`` otherwise.

        Returns:
            The configured :class:`~opentelemetry.sdk.trace.TracerProvider`.

        Example::

            dt = DynatraceClient(
                tenant_url="https://<env-id>.live.dynatrace.com",
                access_token="dt0c01.***",
            )
            dt.configure_tracing(framework="mlflow")
        """
        if not self.tenant_url:
            raise ValueError("Tenant URL is not set. Pass tenant_url= or set DT_TENANT_URL.")
        if not self.access_token:
            raise ValueError("No access token set. Pass access_token= or set DT_ACCESS_TOKEN.")

        if framework == "mlflow":
            from dt_ai_ingest.mlflow.tracing import configure_dynatrace_tracing

            return configure_dynatrace_tracing(
                self.tenant_url,
                self.access_token,
                service_name=service_name or "mlflow-eval",
            )
        elif framework == "langfuse":
            from dt_ai_ingest.langfuse.tracing import configure_dynatrace_tracing

            return configure_dynatrace_tracing(
                self.tenant_url,
                self.access_token,
                service_name=service_name or "langfuse-eval",
            )
        else:
            from dt_ai_ingest._otel import configure_tracing

            return configure_tracing(
                self.tenant_url,
                self.access_token,
                service_name=service_name or "dt-ai-ingest",
            )


def _detect_adapter(result: Any) -> str | None:
    """Identify which framework produced *result* via duck typing.

    Returns ``"ragas"``, ``"deepeval"``, ``"mlflow"``, ``"langfuse"``,
    or ``None`` if unrecognised.
    """
    # DeepEval: has .test_results (list of test case results)
    # Check before MLflow because both could theoretically have .metrics
    if hasattr(result, "test_results"):
        return "deepeval"

    # Ragas: has .scores (list of per-sample score dicts)
    if hasattr(result, "scores") and isinstance(getattr(result, "scores", None), list):
        return "ragas"

    # MLflow: has .metrics (dict of metric_name → value)
    if hasattr(result, "metrics") and isinstance(getattr(result, "metrics", None), dict):
        return "mlflow"

    # Langfuse client: has .api.scores (v4+) or .api.score_v_2 (v3),
    # or characteristic methods when api is not initialised (no credentials)
    api = getattr(result, "api", None)
    if api is not None and (hasattr(api, "scores") or hasattr(api, "score_v_2")):
        return "langfuse"
    if hasattr(result, "create_score") and hasattr(result, "start_as_current_observation"):
        return "langfuse"

    return None
