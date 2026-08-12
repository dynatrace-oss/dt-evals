"""HTTP transport: BizEvents egress with retry, chunking, and client lifecycle.

Owns a single ``httpx.AsyncClient``, chunks large batches with bounded
concurrency, and retries transient failures with exponential backoff + jitter.
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_BIZEVENTS_PATH_CLASSIC = "/api/v2/bizevents/ingest"
_BIZEVENTS_PATH_PLATFORM = "/platform/classic/environment-api/v2/bizevents/ingest"
_PLATFORM_URL_MARKERS = (".apps.dynatrace.com", ".apps.dynatracelabs.com")

_RETRYABLE_STATUS_CODES = frozenset({429, 502, 503, 504})
_BASE_BACKOFF_SECONDS = 1.0
_MAX_BACKOFF_SECONDS = 60.0
_MAX_CONCURRENT_CHUNKS = 5


def bizevents_path(endpoint: str) -> str:
    """Return the BizEvents ingest path: platform apps URLs proxy via a longer path."""
    is_platform = any(marker in endpoint for marker in _PLATFORM_URL_MARKERS)
    return _BIZEVENTS_PATH_PLATFORM if is_platform else _BIZEVENTS_PATH_CLASSIC


class Transport:
    """Posts BizEvents to Dynatrace with retry and bounded-concurrency chunking."""

    def __init__(
        self,
        endpoint: str,
        token: str,
        *,
        timeout: float = 30.0,
        chunk_size: int = 100,
        max_retries: int = 3,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.chunk_size = chunk_size
        if max_retries < 1:
            raise ValueError("max_retries must be >= 1")
        self.max_retries = max_retries
        self._external = http_client
        self._owned: httpx.AsyncClient | None = None

    @property
    def url(self) -> str:
        return f"{self.endpoint}{bizevents_path(self.endpoint)}"

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    @property
    def _http(self) -> httpx.AsyncClient:
        if self._external is not None:
            return self._external
        if self._owned is None or self._owned.is_closed:
            self._owned = httpx.AsyncClient(timeout=self.timeout)
        return self._owned

    async def aclose(self) -> None:
        if self._owned is not None and not self._owned.is_closed:
            await self._owned.aclose()
            self._owned = None

    async def send(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        chunks = [rows[i : i + self.chunk_size] for i in range(0, len(rows), self.chunk_size)]
        if len(chunks) == 1:
            await self._send_chunk(chunks[0])
            return
        sem = asyncio.Semaphore(_MAX_CONCURRENT_CHUNKS)

        async def _guarded(chunk: list[dict[str, Any]]) -> None:
            async with sem:
                await self._send_chunk(chunk)

        results = await asyncio.gather(
            *[_guarded(chunk) for chunk in chunks], return_exceptions=True
        )
        errors = [e for e in results if isinstance(e, BaseException)]
        if errors:
            logger.error("%d/%d chunk(s) failed", len(errors), len(chunks))
            raise errors[0]

    async def _send_chunk(self, chunk: list[dict[str, Any]]) -> None:
        response = await self._request_with_retry(chunk)
        logger.debug("Sent %d BizEvents -> HTTP %s", len(chunk), response.status_code)

    async def _request_with_retry(self, payload: Any) -> httpx.Response:
        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = await self._http.post(self.url, headers=self._headers, json=payload)
                if response.status_code not in _RETRYABLE_STATUS_CODES:
                    response.raise_for_status()
                    return response
                if attempt == self.max_retries:
                    response.raise_for_status()
                    return response
                delay = self._backoff(attempt, response)
                logger.warning(
                    "HTTP %s (attempt %d/%d), retrying in %.1fs",
                    response.status_code,
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
                delay = self._backoff(attempt)
                logger.warning(
                    "Request error: %s (attempt %d/%d), retrying in %.1fs",
                    exc,
                    attempt,
                    self.max_retries,
                    delay,
                )
                await asyncio.sleep(delay)
        assert last_exc is not None
        raise last_exc

    @staticmethod
    def _backoff(attempt: int, response: httpx.Response | None = None) -> float:
        if response is not None and response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            if retry_after is not None:
                try:
                    return float(retry_after)
                except ValueError:
                    pass
        cap = min(_BASE_BACKOFF_SECONDS * (2 ** (attempt - 1)), _MAX_BACKOFF_SECONDS)
        return random.uniform(0, cap)  # noqa: S311
