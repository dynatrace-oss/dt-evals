"""Tests for dt_ai_ingest._otel — idempotent TracerProvider setup (CORE-05)."""

from __future__ import annotations

import warnings

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor

from dt_ai_ingest._otel import _reset_configured_params, configure_tracing


@pytest.fixture(autouse=True)
def _reset_tracer_provider():
    """Reset global tracer provider between tests."""
    yield
    # Reset to default ProxyTracerProvider.
    # OTel's global state reset requires touching internals.
    trace._TRACER_PROVIDER = None  # type: ignore[attr-defined]
    trace._TRACER_PROVIDER_SET_ONCE._done = False  # type: ignore[attr-defined]
    _reset_configured_params()


class TestConfigureTracing:
    def test_creates_provider(self):
        provider = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test",
        )
        assert isinstance(provider, TracerProvider)
        assert trace.get_tracer_provider() is provider

    def test_returns_provider(self):
        result = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test",
        )
        assert isinstance(result, TracerProvider)

    def test_twice_same_params_returns_same_provider_no_warning(self):
        """Calling with identical params is a no-op — same provider, no warning."""
        provider1 = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test1",
        )

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            provider2 = configure_tracing(
                dt_endpoint="https://abc.live.dynatrace.com",
                dt_access_token="dt0c01.test1",
            )

        assert provider1 is provider2
        assert len(w) == 0

        # Should still have only 1 processor (not duplicated)
        composite = provider1._active_span_processor  # type: ignore[attr-defined]
        processors = composite._span_processors  # type: ignore[attr-defined]
        assert len(processors) == 1
        assert isinstance(processors[0], BatchSpanProcessor)

    def test_twice_different_endpoint_warns_and_returns_same_provider(self):
        """Calling with a different endpoint emits a UserWarning."""
        provider1 = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test1",
        )

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            provider2 = configure_tracing(
                dt_endpoint="https://xyz.live.dynatrace.com",
                dt_access_token="dt0c01.test1",
            )

        assert provider1 is provider2
        assert len(w) == 1
        assert issubclass(w[0].category, UserWarning)
        assert "dt_endpoint" in str(w[0].message)
        assert "already called" in str(w[0].message)

    def test_twice_different_token_warns(self):
        provider1 = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test1",
        )

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            provider2 = configure_tracing(
                dt_endpoint="https://abc.live.dynatrace.com",
                dt_access_token="dt0c01.DIFFERENT",
            )

        assert provider1 is provider2
        assert len(w) == 1
        assert "dt_access_token" in str(w[0].message)

    def test_twice_different_service_name_warns(self):
        provider1 = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test1",
            service_name="service-a",
        )

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            provider2 = configure_tracing(
                dt_endpoint="https://abc.live.dynatrace.com",
                dt_access_token="dt0c01.test1",
                service_name="service-b",
            )

        assert provider1 is provider2
        assert len(w) == 1
        assert "service_name" in str(w[0].message)

    def test_no_duplicate_processors_on_repeated_calls(self):
        """Repeated identical calls must NOT add extra processors."""
        configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test",
        )
        provider = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test",
        )
        provider = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test",
        )

        composite = provider._active_span_processor  # type: ignore[attr-defined]
        processors = composite._span_processors  # type: ignore[attr-defined]
        assert len(processors) == 1

    def test_does_not_replace_existing_provider_with_custom_processor(self):
        """Pre-set a TracerProvider with a custom processor, then call configure_tracing.
        The original processor must still be present."""
        from opentelemetry.sdk.trace.export import ConsoleSpanExporter

        existing = TracerProvider()
        custom_processor = SimpleSpanProcessor(ConsoleSpanExporter())
        existing.add_span_processor(custom_processor)
        trace.set_tracer_provider(existing)

        returned = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test",
        )

        assert returned is existing

        composite = existing._active_span_processor  # type: ignore[attr-defined]
        processors = composite._span_processors  # type: ignore[attr-defined]
        assert len(processors) == 2
        assert processors[0] is custom_processor

    def test_service_name_used_for_new_provider(self):
        provider = configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com",
            dt_access_token="dt0c01.test",
            service_name="my-service",
        )
        resource = provider.resource  # type: ignore[attr-defined]
        assert resource.attributes.get("service.name") == "my-service"

    def test_endpoint_trailing_slash_normalised(self):
        """Trailing slashes should not cause false-positive 'different params' warnings."""
        configure_tracing(
            dt_endpoint="https://abc.live.dynatrace.com/",
            dt_access_token="dt0c01.test",
        )

        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            configure_tracing(
                dt_endpoint="https://abc.live.dynatrace.com",
                dt_access_token="dt0c01.test",
            )

        assert len(w) == 0
