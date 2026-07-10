"""Unit tests for dt_ai_ingest.deepeval.tracing."""

from unittest.mock import MagicMock, patch

import pytest

import dt_ai_ingest.deepeval.tracing as dt_tracing
from dt_ai_ingest.deepeval.tracing import (
    _install_trace_hook,
    _reset_hook_state,
    configure_dynatrace_tracing,
)


@pytest.fixture
def restore_end_trace():
    """Restore trace_manager.end_trace and module state around a test."""
    from deepeval.tracing import trace_manager

    original = trace_manager.end_trace
    _reset_hook_state()
    yield
    trace_manager.end_trace = original
    _reset_hook_state()


class TestConfigureDynatraceTracing:
    def test_delegates_to_configure_tracing(self):
        """Verify it wraps _otel.configure_tracing with the deepeval defaults."""
        with (
            patch("dt_ai_ingest.deepeval.tracing.configure_tracing") as mock_ct,
            patch("dt_ai_ingest.deepeval.tracing._install_trace_hook"),
        ):
            mock_provider = MagicMock()
            mock_ct.return_value = mock_provider

            result = configure_dynatrace_tracing(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
            )

            mock_ct.assert_called_once_with(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
                service_name="deepeval-eval",
            )
            assert result is mock_provider

    def test_default_service_name_is_deepeval_eval(self):
        """Default service_name is 'deepeval-eval'."""
        with (
            patch("dt_ai_ingest.deepeval.tracing.configure_tracing") as mock_ct,
            patch("dt_ai_ingest.deepeval.tracing._install_trace_hook"),
        ):
            mock_ct.return_value = MagicMock()

            configure_dynatrace_tracing(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
            )

            _, kwargs = mock_ct.call_args
            assert kwargs["service_name"] == "deepeval-eval"

    def test_custom_service_name(self):
        """Verify custom service_name is forwarded."""
        with (
            patch("dt_ai_ingest.deepeval.tracing.configure_tracing") as mock_ct,
            patch("dt_ai_ingest.deepeval.tracing._install_trace_hook"),
        ):
            mock_ct.return_value = MagicMock()

            configure_dynatrace_tracing(
                dt_endpoint="https://test.live.dynatrace.com",
                dt_access_token="dt0c01.test",
                service_name="my-deepeval-app",
            )

            _, kwargs = mock_ct.call_args
            assert kwargs["service_name"] == "my-deepeval-app"


class TestEndTraceHook:
    def test_hook_replaces_end_trace(self, restore_end_trace):
        """After install, trace_manager.end_trace is a different callable."""
        from deepeval.tracing import trace_manager

        original = trace_manager.end_trace
        _install_trace_hook(MagicMock())

        assert trace_manager.end_trace is not original
        assert dt_tracing._hook_installed is True

    def test_hook_calls_original_and_emits_captured_trace(self, restore_end_trace):
        """Patched end_trace forwards to the original and emits the active trace."""
        from deepeval.tracing import trace_manager

        original = MagicMock(return_value="done")
        trace_manager.end_trace = original
        fake_trace = object()
        trace_manager.active_traces["uuid-1"] = fake_trace

        try:
            with patch(
                "dt_ai_ingest.deepeval.tracing._emit_trace_as_otel"
            ) as mock_emit:
                _install_trace_hook(MagicMock())
                result = trace_manager.end_trace("uuid-1")
        finally:
            trace_manager.active_traces.pop("uuid-1", None)

        original.assert_called_once_with("uuid-1")
        mock_emit.assert_called_once()
        assert mock_emit.call_args[0][0] is fake_trace
        assert result == "done"

    def test_trace_captured_before_original_deletes_it(self, restore_end_trace):
        """The real end_trace deletes from active_traces, so we must capture first.

        Uses a fake original that mimics deepeval by popping the uuid; if the
        capture happened *after* the original, _emit would receive None.
        """
        from deepeval.tracing import trace_manager

        fake_trace = object()
        trace_manager.active_traces["uuid-3"] = fake_trace

        def fake_end_trace(trace_uuid):
            # Mimic deepeval: remove the trace from active_traces.
            trace_manager.active_traces.pop(trace_uuid, None)
            return "finalized"

        trace_manager.end_trace = fake_end_trace

        try:
            with patch(
                "dt_ai_ingest.deepeval.tracing._emit_trace_as_otel"
            ) as mock_emit:
                _install_trace_hook(MagicMock())
                trace_manager.end_trace("uuid-3")
        finally:
            trace_manager.active_traces.pop("uuid-3", None)

        mock_emit.assert_called_once()
        assert mock_emit.call_args[0][0] is fake_trace  # not None

    def test_hook_is_idempotent(self, restore_end_trace):
        """Installing twice does not nest the wrapper."""
        _install_trace_hook(MagicMock())
        from deepeval.tracing import trace_manager

        first = trace_manager.end_trace
        _install_trace_hook(MagicMock())
        assert trace_manager.end_trace is first

    def test_otel_failure_does_not_break_original(self, restore_end_trace):
        """A failure emitting OTel spans must not prevent the original call."""
        from deepeval.tracing import trace_manager

        original = MagicMock(return_value="ok")
        trace_manager.end_trace = original
        trace_manager.active_traces["uuid-2"] = object()

        try:
            with patch(
                "dt_ai_ingest.deepeval.tracing._emit_trace_as_otel",
                side_effect=RuntimeError("boom"),
            ):
                _install_trace_hook(MagicMock())
                result = trace_manager.end_trace("uuid-2")
        finally:
            trace_manager.active_traces.pop("uuid-2", None)

        original.assert_called_once()
        assert result == "ok"

    def test_configure_registers_single_atexit(self, restore_end_trace):
        """Repeated configure calls register at most one atexit handler."""
        with (
            patch("dt_ai_ingest.deepeval.tracing.configure_tracing") as mock_ct,
            patch("dt_ai_ingest.deepeval.tracing._install_trace_hook"),
            patch("dt_ai_ingest.deepeval.tracing.atexit.register") as mock_reg,
        ):
            mock_ct.return_value = MagicMock()
            configure_dynatrace_tracing("https://t.live.dynatrace.com", "dt0c01.t")
            configure_dynatrace_tracing("https://t.live.dynatrace.com", "dt0c01.t")

        assert mock_reg.call_count == 1


def _in_memory_tracer():
    """A tracer whose spans are captured in memory for assertions."""
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test"), exporter


def _make_llm_trace(*, name="llm_call", model="gpt-5-mini", error=None):
    """Build a minimal DeepEval Trace containing one LlmSpan."""
    from time import perf_counter

    from deepeval.tracing.types import LlmSpan, Trace, TraceSpanStatus

    start = perf_counter()
    end = start + 0.05
    status = TraceSpanStatus.ERRORED if error else TraceSpanStatus.SUCCESS
    span = LlmSpan(
        uuid="span-1",
        status=status,
        trace_uuid="trace-1",
        start_time=start,
        end_time=end,
        name=name,
        model=model,
        input="Why is the sky blue?",
        output="Rayleigh scattering.",
        input_token_count=12,
        output_token_count=8,
        error=error,
    )
    return Trace(
        uuid="trace-1",
        status=status,
        root_spans=[span],
        start_time=start,
        end_time=end,
        name="root",
    )


class TestEmitTraceAsOtel:
    def test_llm_span_becomes_otel_span(self):
        from deepeval.tracing import perf_epoch_bridge as peb

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()

        _emit_trace_as_otel(_make_llm_trace(), tracer)

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        span = spans[0]
        assert span.name == "llm_call"
        assert span.start_time < span.end_time
        assert span.attributes["gen_ai.request.model"] == "gpt-5-mini"
        assert span.attributes["gen_ai.usage.input_tokens"] == 12
        assert span.attributes["gen_ai.usage.output_tokens"] == 8
        assert span.attributes["deepeval.span.type"] == "llm"

    def test_input_output_not_captured_by_default(self):
        """Privacy: prompt/response must NOT leave the process unless opted in."""
        from deepeval.tracing import perf_epoch_bridge as peb

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()
        _emit_trace_as_otel(_make_llm_trace(), tracer)

        span = exporter.get_finished_spans()[0]
        assert "deepeval.input" not in span.attributes
        assert "deepeval.output" not in span.attributes

    def test_input_output_captured_when_opted_in(self):
        from deepeval.tracing import perf_epoch_bridge as peb

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()
        _emit_trace_as_otel(_make_llm_trace(), tracer, capture_content=True)

        span = exporter.get_finished_spans()[0]
        assert span.attributes["deepeval.input"] == "Why is the sky blue?"
        assert span.attributes["deepeval.output"] == "Rayleigh scattering."

    def test_llm_span_kind_is_client(self):
        from deepeval.tracing import perf_epoch_bridge as peb
        from opentelemetry.trace import SpanKind

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()
        _emit_trace_as_otel(_make_llm_trace(), tracer)

        assert exporter.get_finished_spans()[0].kind == SpanKind.CLIENT

    def test_timestamps_are_near_wall_clock(self):
        """Guard against perf/epoch conversion regressions (e.g. missing anchor)."""
        import time

        from deepeval.tracing import perf_epoch_bridge as peb

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()
        _emit_trace_as_otel(_make_llm_trace(), tracer)

        span = exporter.get_finished_spans()[0]
        now_ns = time.time_ns()
        # Span start should be within ~10s of now, not 1970 or the far future.
        assert abs(now_ns - span.start_time) < 10_000_000_000

    def test_nested_spans_share_trace_and_link_parent(self):
        from time import perf_counter

        from deepeval.tracing import perf_epoch_bridge as peb
        from deepeval.tracing.types import BaseSpan, LlmSpan, Trace, TraceSpanStatus

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()

        start = perf_counter()
        child = LlmSpan(
            uuid="child",
            status=TraceSpanStatus.SUCCESS,
            trace_uuid="t",
            parent_uuid="root",
            start_time=start + 0.01,
            end_time=start + 0.04,
            name="llm_call",
            model="gpt-5-mini",
        )
        root = BaseSpan(
            uuid="root",
            status=TraceSpanStatus.SUCCESS,
            trace_uuid="t",
            start_time=start,
            end_time=start + 0.05,
            name="rag_pipeline",
            children=[child],
        )
        trace = Trace(
            uuid="t",
            status=TraceSpanStatus.SUCCESS,
            root_spans=[root],
            start_time=start,
            end_time=start + 0.05,
        )

        _emit_trace_as_otel(trace, tracer)

        spans = {s.name: s for s in exporter.get_finished_spans()}
        assert set(spans) == {"rag_pipeline", "llm_call"}
        root_span, child_span = spans["rag_pipeline"], spans["llm_call"]
        # same trace
        assert child_span.context.trace_id == root_span.context.trace_id
        # child's parent is the root span
        assert child_span.parent.span_id == root_span.context.span_id

    def test_success_status_is_ok(self):
        from deepeval.tracing import perf_epoch_bridge as peb
        from opentelemetry.trace import StatusCode

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()
        _emit_trace_as_otel(_make_llm_trace(), tracer)

        span = exporter.get_finished_spans()[0]
        assert span.status.status_code in (StatusCode.OK, StatusCode.UNSET)

    def test_error_span_sets_error_status(self):
        from deepeval.tracing import perf_epoch_bridge as peb
        from opentelemetry.trace import StatusCode

        from dt_ai_ingest.deepeval.tracing import _emit_trace_as_otel

        peb.init_clock_bridge()
        tracer, exporter = _in_memory_tracer()
        _emit_trace_as_otel(_make_llm_trace(error="rate limited"), tracer)

        span = exporter.get_finished_spans()[0]
        assert span.status.status_code == StatusCode.ERROR
        assert "rate limited" in (span.status.description or "")


class TestClientDelegation:
    def test_client_configure_tracing_deepeval_branch(self):
        """DynatraceClient.configure_tracing(framework='deepeval') delegates."""
        from dt_ai_ingest.client import DynatraceClient

        client = DynatraceClient(
            tenant_url="https://test.live.dynatrace.com",
            access_token="dt0c01.test",
        )
        with patch(
            "dt_ai_ingest.deepeval.tracing.configure_dynatrace_tracing"
        ) as mock_cfg:
            mock_provider = MagicMock()
            mock_cfg.return_value = mock_provider

            result = client.configure_tracing(framework="deepeval")

            mock_cfg.assert_called_once_with(
                "https://test.live.dynatrace.com",
                "dt0c01.test",
                service_name="deepeval-eval",
            )
            assert result is mock_provider
