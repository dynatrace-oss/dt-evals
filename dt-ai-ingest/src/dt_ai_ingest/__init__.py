"""dt_ai_ingest — ingest AI evaluation results into Dynatrace as BizEvents.

The module-level helpers are awaitable and create a one-shot client from
``DT_ENDPOINT`` / ``DT_API_TOKEN``; use :class:`DynatraceClient` directly to
reuse a connection or configure it explicitly.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.schema import Eval
from dt_ai_ingest.scope import EvaluationScope
from dt_ai_ingest.spans import current_span_ids

__all__ = [
    "DynatraceClient",
    "Eval",
    "current_span_ids",
    "evaluation",
    "ingest",
    "ingest_file",
    "submit",
]


async def submit(name: str, *, span: Any = None, **fields: Any) -> int:
    """Submit one evaluation (zero-config). See :meth:`DynatraceClient.submit`."""
    async with DynatraceClient() as client:
        return await client.submit(name, span=span, **fields)


async def ingest(evals: Iterable[Eval | dict[str, Any]]) -> int:
    """Ingest a batch of evals (zero-config). See :meth:`DynatraceClient.ingest`."""
    async with DynatraceClient() as client:
        return await client.ingest(evals)


async def ingest_file(
    path: str,
    *,
    mapping: Mapping[str, str] | None = None,
    defaults: Mapping[str, Any] | None = None,
    run_id: str | None = None,
) -> int:
    """Ingest a CSV/JSONL/JSON file of evals. See :meth:`DynatraceClient.ingest_file`."""
    async with DynatraceClient() as client:
        return await client.ingest_file(
            path, mapping=mapping, defaults=defaults, run_id=run_id
        )


def evaluation(**attach: Any) -> EvaluationScope:
    """Open an inline evaluation scope (zero-config). See :meth:`DynatraceClient.evaluation`."""
    return EvaluationScope(DynatraceClient(), close_client=True, **attach)
