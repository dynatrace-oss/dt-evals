"""The Dynatrace evaluation-ingest client.

``DynatraceClient`` is the one place that turns ``Eval``s into BizEvents and
ships them. It is async and send-only: it never fetches spans and never exports
traces. Credentials come from ``endpoint=`` / ``token=`` or ``DT_ENDPOINT`` /
``DT_API_TOKEN`` (with legacy ``DT_TENANT_URL`` / ``DT_ACCESS_TOKEN`` as a fallback).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import Iterable, Mapping
from typing import Any

import httpx

from dt_ai_ingest._transport import Transport
from dt_ai_ingest.readers import rows_to_evals
from dt_ai_ingest.schema import Eval
from dt_ai_ingest.scope import EvaluationScope
from dt_ai_ingest.utils.spans import span_ids

logger = logging.getLogger(__name__)


class DynatraceClient:
    """Ships evaluation results to Dynatrace as BizEvents.

    Args:
        endpoint:    Tenant URL, e.g. ``https://abc.live.dynatrace.com``.
                     Falls back to ``DT_ENDPOINT`` / ``DT_TENANT_URL``.
        token:       DT access token. Falls back to ``DT_API_TOKEN`` / ``DT_ACCESS_TOKEN``.
        dry_run:     When ``True`` events are only logged — no HTTP calls.
        timeout:     HTTP request timeout in seconds.
        chunk_size:  Maximum number of events per HTTP POST.
        max_retries: Attempts for retryable errors.
        http_client: Optional external ``httpx.AsyncClient`` to reuse.
    """

    def __init__(
        self,
        endpoint: str | None = None,
        token: str | None = None,
        *,
        dry_run: bool = False,
        timeout: float = 30.0,
        chunk_size: int = 100,
        max_retries: int = 3,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.endpoint = (
            endpoint or os.environ.get("DT_ENDPOINT") or os.environ.get("DT_TENANT_URL", "")
        ).strip().rstrip("/")
        self.token = (
            token or os.environ.get("DT_API_TOKEN") or os.environ.get("DT_ACCESS_TOKEN", "")
        ).strip()
        self.dry_run = dry_run
        self._transport = Transport(
            self.endpoint,
            self.token,
            timeout=timeout,
            chunk_size=chunk_size,
            max_retries=max_retries,
            http_client=http_client,
        )

    async def ingest(self, evals: Iterable[Eval | dict[str, Any]]) -> int:
        """Send a batch of evals; return the number of BizEvents sent."""
        rows = [self._as_eval(item).to_bizevent() for item in evals]
        if self.dry_run:
            logger.info("[dry-run] %d BizEvent(s):\n%s", len(rows), json.dumps(rows, indent=2))
            return len(rows)
        self._validate_credentials()
        await self._transport.send(rows)
        return len(rows)

    async def ingest_file(
        self,
        path: str,
        *,
        mapping: Mapping[str, str] | None = None,
        defaults: Mapping[str, Any] | None = None,
        dataset_id: str | None = None,
    ) -> int:
        """Read a ``.csv`` / ``.jsonl`` / ``.json`` of eval results and ingest them.

        All rows in a single call share the same ``dataset_id`` (``dt.eval.dataset_id``),
        so you can later ``group by dt.eval.dataset_id`` in DQL to isolate this batch.
        Pass ``dataset_id=`` explicitly for a stable, human-readable label; omit it to
        get an auto-generated UUID.
        """
        _dataset_id = dataset_id if dataset_id is not None else str(uuid.uuid4())
        _defaults: dict[str, Any] = {**(defaults or {}), "dataset_id": _dataset_id}
        evals = await asyncio.to_thread(lambda: list(rows_to_evals(path, mapping, _defaults)))
        return await self.ingest(evals)

    async def submit(self, name: str, *, span: Any = None, **fields: Any) -> int:
        """Submit one evaluation, optionally linked to an OTel *span*."""
        if span is not None:
            trace_id, span_id = span_ids(span)
            fields.setdefault("trace_id", trace_id)
            fields.setdefault("span_id", span_id)
        return await self.ingest([Eval(name=name, **fields)])

    def evaluation(self, **attach: Any) -> EvaluationScope:
        """Open a scope that auto-links evals to the active span (async context manager)."""
        return EvaluationScope(self, **attach)

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> DynatraceClient:
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        await self.aclose()

    @staticmethod
    def _as_eval(item: Eval | dict[str, Any]) -> Eval:
        return item if isinstance(item, Eval) else Eval(**item)

    def _validate_credentials(self) -> None:
        if not self.endpoint:
            raise ValueError("No endpoint set. Pass endpoint= or set DT_ENDPOINT.")
        if not self.token:
            raise ValueError("No token set. Pass token= or set DT_API_TOKEN.")
