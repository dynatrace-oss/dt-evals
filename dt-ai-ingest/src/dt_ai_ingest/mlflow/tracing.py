"""Configure MLflow OTel tracing to export spans to Dynatrace via OTLP."""

from __future__ import annotations

import atexit
import os

from opentelemetry.sdk.trace import TracerProvider

from dt_ai_ingest._otel import configure_tracing

# Track whether we already registered an atexit handler so we don't
# register duplicates when configure_dynatrace_tracing() is called
# multiple times (e.g., notebook cell re-runs).
_atexit_registered: bool = False


def _reset_atexit_flag() -> None:
    """Reset module-level atexit state (for testing only)."""
    global _atexit_registered  # noqa: PLW0603
    _atexit_registered = False


def configure_dynatrace_tracing(
    dt_endpoint: str,
    dt_access_token: str,
    *,
    service_name: str = "mlflow-eval",
) -> TracerProvider:
    """Set up a global OTel TracerProvider that exports to Dynatrace OTLP.

    **Idempotent:** Safe to call multiple times (e.g. re-running a notebook
    cell).  The underlying :func:`~dt_ai_ingest._otel.configure_tracing`
    returns the existing provider on repeated calls, and this function
    registers at most one ``atexit`` handler.

    Must be called **before** any MLflow runs or ``@mlflow.trace`` decorators.

    .. note::

       MLflow 3.x defaults to an **isolated** internal TracerProvider and
       ignores the global OTel one.  This function sets
       ``MLFLOW_USE_DEFAULT_TRACER_PROVIDER=false`` so that MLflow uses the
       globally registered provider (and thus the Dynatrace OTLP exporter).

       An ``atexit`` handler is registered to ``force_flush()`` the provider
       on interpreter shutdown, ensuring buffered spans are exported before
       the process exits.

    Args:
        dt_endpoint:      Base URL of your DT environment, e.g.
                          ``https://<env-id>.live.dynatrace.com``
        dt_access_token:  DT access token.
        service_name:     ``service.name`` resource attribute attached to all spans.

    Returns:
        The configured :class:`TracerProvider` (also registered globally).

    Example::

        from dt_ai_ingest.mlflow.tracing import configure_dynatrace_tracing
        import mlflow

        configure_dynatrace_tracing(
            dt_endpoint="https://<env-id>.live.dynatrace.com",
            dt_access_token="dt0c01.***",
        )

        with mlflow.start_run():
            @mlflow.trace
            def my_llm_call(prompt: str) -> str:
                ...
    """
    global _atexit_registered  # noqa: PLW0603

    # MLflow 3.x uses an isolated TracerProvider by default.  Setting this
    # env var *before* MLflow initialises its tracing makes it fall through
    # to the global OTel TracerProvider that we configure below.
    os.environ.setdefault("MLFLOW_USE_DEFAULT_TRACER_PROVIDER", "false")

    provider = configure_tracing(
        dt_endpoint=dt_endpoint,
        dt_access_token=dt_access_token,
        service_name=service_name,
    )

    # BatchSpanProcessor exports asynchronously — register an atexit handler
    # so buffered spans are flushed before the process exits.
    # Only register once to avoid duplicate handlers on repeated calls.
    if not _atexit_registered:
        atexit.register(provider.force_flush, timeout_millis=5000)
        _atexit_registered = True

    return provider
