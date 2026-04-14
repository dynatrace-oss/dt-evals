"""Configure Langfuse OTel tracing to export spans to Dynatrace via OTLP."""

from __future__ import annotations

from opentelemetry.sdk.trace import TracerProvider

from dt_ai_ingest._otel import configure_tracing


def configure_dynatrace_tracing(
    dt_endpoint: str,
    dt_access_token: str,
    *,
    service_name: str = "langfuse-eval",
) -> TracerProvider:
    """Set up a global OTel TracerProvider that exports to Dynatrace OTLP.

    Langfuse v3+ is OTel-native — it registers a ``LangfuseSpanProcessor``
    on the global ``TracerProvider``.  This function adds a Dynatrace OTLP
    exporter alongside Langfuse's own processor so that spans flow to both
    Langfuse and Dynatrace simultaneously.

    **Idempotent:** If a ``TracerProvider`` already exists (e.g. Langfuse
    already initialised), the DT exporter is added to it rather than
    replacing it.  If called before Langfuse initialises, Langfuse will
    add its processor to the provider we create here.

    Args:
        dt_endpoint:      Base URL of your DT environment, e.g.
                          ``https://<env-id>.live.dynatrace.com``
        dt_access_token:  DT access token.
        service_name:     ``service.name`` resource attribute attached to all spans.

    Returns:
        The configured :class:`TracerProvider` (also registered globally).

    Example::

        from langfuse import Langfuse
        from dt_ai_ingest.langfuse import configure_dynatrace_tracing

        # Order doesn't matter — both work:
        configure_dynatrace_tracing(
            dt_endpoint="https://<env-id>.live.dynatrace.com",
            dt_access_token="dt0c01.***",
        )

        langfuse = Langfuse()  # Adds its processor to the same provider

        @langfuse.observe()
        def my_llm_call(prompt: str) -> str:
            ...  # Spans go to both Langfuse AND Dynatrace
    """
    return configure_tracing(
        dt_endpoint=dt_endpoint,
        dt_access_token=dt_access_token,
        service_name=service_name,
    )
