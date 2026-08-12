"""Scoped inline evaluation.

Collect evals inside an ``async with`` block, auto-link them to the active
OpenTelemetry span, and flush the batch once on exit.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from dt_ai_ingest.schema import Eval
from dt_ai_ingest.spans import current_span_ids

if TYPE_CHECKING:
    from dt_ai_ingest.client import DynatraceClient


class EvaluationScope:
    """Async context manager that batches evals and flushes them on exit."""

    def __init__(
        self, client: DynatraceClient, *, close_client: bool = False, **attach: Any
    ) -> None:
        self._client = client
        self._close_client = close_client
        self._attach = attach
        self._batch: list[Eval] = []

    async def __aenter__(self) -> EvaluationScope:
        trace_id, span_id = current_span_ids()
        self._attach.setdefault("trace_id", trace_id)
        self._attach.setdefault("span_id", span_id)
        self._attach.setdefault("run_id", str(uuid.uuid4()))
        return self

    def record(self, name: str, **fields: Any) -> None:
        """Add one eval to the scope; span linkage is inherited from the context."""
        attached = {key: value for key, value in self._attach.items() if value is not None}
        self._batch.append(Eval(name=name, **{**attached, **fields}))

    def __call__(self, name: str, **fields: Any) -> None:
        self.record(name, **fields)

    async def __aexit__(self, *_exc: Any) -> None:
        try:
            if self._batch:
                await self._client.ingest(self._batch)
        finally:
            if self._close_client:
                await self._client.aclose()
