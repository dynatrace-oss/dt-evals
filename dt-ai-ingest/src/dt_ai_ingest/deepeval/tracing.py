"""Bridge DeepEval's native tracing to Dynatrace via OpenTelemetry.

Unlike MLflow (which emits to the global OTel ``TracerProvider`` via an env var)
and Langfuse (which produces OTel spans natively), DeepEval posts its traces
directly to Confident AI through ``trace_manager.post_trace`` and never touches
the global OTel provider.

This module closes that gap: :func:`configure_dynatrace_tracing` sets up the
Dynatrace OTLP provider *and* installs a hook on ``trace_manager.post_trace``
that converts every completed DeepEval ``Trace`` into OTel spans emitted on that
provider. The user keeps writing ordinary DeepEval tracing code
(``with trace(...)`` / patched ``deepeval.openai`` clients) and spans flow to
Dynatrace automatically.
"""

from __future__ import annotations

import atexit
import logging

from opentelemetry.sdk.trace import TracerProvider

from dt_ai_ingest._otel import configure_tracing

logger = logging.getLogger(__name__)

# Module-level state so repeated calls (e.g. notebook cell re-runs) don't
# double-wrap end_trace or register duplicate atexit handlers.
_hook_installed: bool = False
_atexit_registered: bool = False
_original_end_trace = None  # the un-patched trace_manager.end_trace


def _reset_hook_state() -> None:
    """Reset module-level state (for testing only)."""
    global _hook_installed, _atexit_registered, _original_end_trace  # noqa: PLW0603
    _hook_installed = False
    _atexit_registered = False
    _original_end_trace = None


def configure_dynatrace_tracing(
    dt_endpoint: str,
    dt_access_token: str,
    *,
    service_name: str = "deepeval-eval",
    capture_content: bool = False,
) -> TracerProvider:
    """Set up a global OTel ``TracerProvider`` and bridge DeepEval traces to it.

    **Idempotent:** Safe to call multiple times. The underlying
    :func:`~dt_ai_ingest._otel.configure_tracing` returns the existing provider
    on repeated calls, the ``end_trace`` hook is installed at most once, and at
    most one ``atexit`` flush handler is registered.

    Must be called **before** running DeepEval traces.

    Args:
        dt_endpoint:      Base URL, e.g. ``https://<env-id>.live.dynatrace.com``.
        dt_access_token:  DT access token.
        service_name:     ``service.name`` resource attribute on all spans.
        capture_content:  When ``True``, attach the evaluated prompt/response as
                          span attributes (``deepeval.input`` / ``deepeval.output``).
                          Defaults to ``False`` so sensitive content never leaves
                          the process by default, consistent with the platform's
                          policy of not exporting evaluated prompt/response.

    Returns:
        The configured :class:`TracerProvider` (also registered globally).
    """
    global _atexit_registered  # noqa: PLW0603

    provider = configure_tracing(
        dt_endpoint=dt_endpoint,
        dt_access_token=dt_access_token,
        service_name=service_name,
    )

    _install_trace_hook(provider, capture_content=capture_content)

    if not _atexit_registered:
        atexit.register(provider.force_flush, timeout_millis=5000)
        _atexit_registered = True

    return provider


def _install_trace_hook(provider: TracerProvider, *, capture_content: bool = False) -> None:
    """Monkey-patch ``trace_manager.end_trace`` to also emit OTel spans.

    ``end_trace`` is the one hook point invoked for **every** completed trace
    regardless of mode. ``post_trace`` is skipped entirely during evaluation
    runs (``dataset.evals_iterator`` sets ``trace_manager.evaluating = True``),
    so hooking it would miss the traces produced by the common eval-driven flow.

    Idempotent: only the first call wraps the original; subsequent calls are
    no-ops so the wrapper is never nested. Because it does not restore the
    original on its own, :func:`_reset_hook_state` alone must not be used to
    re-install in the same process without also restoring
    ``trace_manager.end_trace`` (tests handle this via a fixture).
    """
    global _hook_installed, _original_end_trace  # noqa: PLW0603
    if _hook_installed:
        return

    from deepeval.tracing import perf_epoch_bridge as peb
    from deepeval.tracing import trace_manager

    # Anchor deepeval's perf_counter() clock to wall-clock epoch so span
    # timestamps convert correctly to OTel epoch-nanoseconds.
    peb.init_clock_bridge()

    tracer = provider.get_tracer("dt-ai-ingest.deepeval")
    _original_end_trace = trace_manager.end_trace

    def _patched_end_trace(trace_uuid):  # noqa: ANN001, ANN202
        # Capture the trace before the original removes it from active_traces.
        trace = trace_manager.active_traces.get(trace_uuid)
        # Let the original finalize end_time/status (and post/queue) first.
        result = None
        if _original_end_trace is not None:
            result = _original_end_trace(trace_uuid)
        # Emit to Dynatrace; a failure here must never break end_trace.
        if trace is not None:
            try:
                _emit_trace_as_otel(trace, tracer, capture_content=capture_content)
            except Exception:  # noqa: BLE001
                logger.warning(
                    "Failed to emit DeepEval trace to Dynatrace", exc_info=True
                )
        return result

    trace_manager.end_trace = _patched_end_trace
    _hook_installed = True


_SPAN_TYPE_BY_CLASS = {
    "LlmSpan": "llm",
    "ToolSpan": "tool",
    "RetrieverSpan": "retriever",
    "AgentSpan": "agent",
    "BaseSpan": "span",
}


def _span_type(span) -> str:  # noqa: ANN001
    return _SPAN_TYPE_BY_CLASS.get(type(span).__name__, "span")


def _span_attributes(span, *, capture_content: bool) -> dict:  # noqa: ANN001
    """Map a DeepEval span's fields onto OTel span attributes.

    Prompt/response content is included only when *capture_content* is True.
    """
    attrs: dict[str, object] = {"deepeval.span.type": _span_type(span)}

    if capture_content:
        if span.input is not None:
            attrs["deepeval.input"] = str(span.input)
        if span.output is not None:
            attrs["deepeval.output"] = str(span.output)

    # LlmSpan-specific fields (guarded with getattr so any span type is safe).
    model = getattr(span, "model", None)
    if model is not None:
        attrs["gen_ai.request.model"] = model
    input_tokens = getattr(span, "input_token_count", None)
    if input_tokens is not None:
        attrs["gen_ai.usage.input_tokens"] = int(input_tokens)
    output_tokens = getattr(span, "output_token_count", None)
    if output_tokens is not None:
        attrs["gen_ai.usage.output_tokens"] = int(output_tokens)

    return attrs


def _emit_trace_as_otel(trace, tracer, *, capture_content: bool = False) -> None:  # noqa: ANN001
    """Convert a completed DeepEval ``Trace`` into nested OTel spans."""
    for root in trace.root_spans:
        _emit_span(root, tracer, parent_context=None, capture_content=capture_content)


def _emit_span(span, tracer, parent_context, *, capture_content: bool) -> None:  # noqa: ANN001
    """Recursively emit *span* and its children as OTel spans."""
    from deepeval.tracing import perf_epoch_bridge as peb
    from deepeval.tracing.types import TraceSpanStatus
    from opentelemetry.trace import SpanKind, Status, StatusCode, set_span_in_context

    start_ns = peb.perf_seconds_to_epoch_nanos(span.start_time)
    end_perf = span.end_time if span.end_time is not None else span.start_time
    end_ns = peb.perf_seconds_to_epoch_nanos(end_perf)

    # LLM calls are outbound client requests; other steps are internal.
    kind = SpanKind.CLIENT if _span_type(span) == "llm" else SpanKind.INTERNAL

    otel_span = tracer.start_span(
        name=span.name or _span_type(span),
        context=parent_context,
        kind=kind,
        start_time=start_ns,
        attributes=_span_attributes(span, capture_content=capture_content),
    )

    if span.error:
        otel_span.set_status(Status(StatusCode.ERROR, str(span.error)))
    elif span.status == TraceSpanStatus.ERRORED:
        otel_span.set_status(Status(StatusCode.ERROR))
    else:
        otel_span.set_status(Status(StatusCode.OK))

    # Ensure the span is always ended even if a child raises mid-recursion,
    # so partial failures don't leak un-exported spans.
    try:
        child_context = set_span_in_context(otel_span)
        for child in span.children:
            _emit_span(child, tracer, child_context, capture_content=capture_content)
    finally:
        otel_span.end(end_time=end_ns)
