"""Read OpenTelemetry span identifiers.

OpenTelemetry is a soft dependency: when it is absent, or no span is active,
the helpers return ``(None, None)`` and the eval is simply standalone.
"""

from __future__ import annotations

from typing import Any


def _format_ids(context: Any) -> tuple[str | None, str | None]:
    if context is None or not getattr(context, "is_valid", False):
        return None, None
    return f"{context.trace_id:032x}", f"{context.span_id:016x}"


def current_span_ids() -> tuple[str | None, str | None]:
    """Return ``(trace_id, span_id)`` of the active OTel span, or ``(None, None)``."""
    try:
        from opentelemetry import trace
    except ImportError:
        return None, None
    return _format_ids(trace.get_current_span().get_span_context())


def span_ids(span: Any) -> tuple[str | None, str | None]:
    """Return ``(trace_id, span_id)`` for an OTel *span* object, or ``(None, None)``."""
    if span is None:
        return None, None
    getter = getattr(span, "get_span_context", None)
    return _format_ids(getter()) if callable(getter) else (None, None)
