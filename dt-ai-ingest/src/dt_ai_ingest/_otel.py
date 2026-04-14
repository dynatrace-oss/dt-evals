"""Shared OTel TracerProvider setup for Dynatrace OTLP export."""

from __future__ import annotations

import hashlib
import logging
import warnings

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from dt_ai_ingest.auth import make_auth_header

logger = logging.getLogger(__name__)

# Track the parameters used for the initial configuration so we can warn
# if a subsequent call uses different values.  The access token is stored
# as a SHA-256 hash only — never as plaintext — to prevent accidental leaks
# via debug dumps or logging framework introspection.
_configured_params: dict[str, str] | None = None

# Track the provider object itself so the idempotency fast-path detects when
# an external framework has replaced the global provider between calls.
_configured_provider: TracerProvider | None = None


def _reset_configured_params() -> None:
    """Reset module-level state (for testing only)."""
    global _configured_params, _configured_provider  # noqa: PLW0603
    _configured_params = None
    _configured_provider = None


def _hash_token(token: str) -> str:
    """Return a hex SHA-256 digest of *token* for safe comparison."""
    return hashlib.sha256(token.encode()).hexdigest()


def configure_tracing(
    dt_endpoint: str,
    dt_access_token: str,
    *,
    service_name: str = "dt-ai-ingest",
) -> TracerProvider:
    """Set up OTel tracing that exports to Dynatrace OTLP.

    **Idempotent:** If this function has already been called and a
    ``TracerProvider`` created by this library is registered globally,
    the *same* provider is returned without adding duplicate processors.

    If called again with **different** ``dt_endpoint`` or
    ``dt_access_token``, a :class:`UserWarning` is emitted and the
    original provider is returned unchanged.  This protects notebook
    users who accidentally re-run a cell from silently orphaning
    providers.

    If a ``TracerProvider`` was set up *externally* (not by this library),
    a new ``BatchSpanProcessor`` is added to it — the existing provider
    is never replaced.

    Args:
        dt_endpoint:      Base URL, e.g. ``https://<env-id>.live.dynatrace.com``
        dt_access_token:  DT access token.
        service_name:     ``service.name`` resource attribute (used only if
                          creating a new provider).

    Returns:
        The ``TracerProvider`` (existing or newly created).
    """
    global _configured_params, _configured_provider  # noqa: PLW0603

    normalised_endpoint = dt_endpoint.rstrip("/")
    otlp_endpoint = f"{normalised_endpoint}/api/v2/otlp/v1/traces"
    token_hash = _hash_token(dt_access_token)

    current = trace.get_tracer_provider()

    # --- Fast path: we already configured THIS provider in a previous call ---
    # Check identity of the provider object, not just the params, so that if an
    # external framework replaces the global provider we fall through and attach
    # our exporter to the new one rather than silently returning.
    if _configured_params is not None and _configured_provider is current and isinstance(current, TracerProvider):
        changed: list[str] = []
        if _configured_params["dt_endpoint"] != normalised_endpoint:
            changed.append("dt_endpoint")
        if _configured_params["dt_access_token"] != token_hash:
            changed.append("dt_access_token")
        if _configured_params["service_name"] != service_name:
            changed.append("service_name")

        if changed:
            warnings.warn(
                f"configure_tracing() already called with different "
                f"{', '.join(changed)}. Returning existing TracerProvider. "
                f"Call is a no-op to avoid orphaned providers.",
                UserWarning,
                stacklevel=2,
            )
        else:
            logger.debug("configure_tracing() already configured — returning existing provider.")

        return current

    # --- A TracerProvider exists but was NOT created by us (or was replaced) ---
    if isinstance(current, TracerProvider):
        exporter = OTLPSpanExporter(
            endpoint=otlp_endpoint,
            headers={"Authorization": make_auth_header(dt_access_token)},
        )
        current.add_span_processor(BatchSpanProcessor(exporter))
        _configured_params = {
            "dt_endpoint": normalised_endpoint,
            "dt_access_token": token_hash,
            "service_name": service_name,
        }
        _configured_provider = current
        return current

    # --- No SDK provider yet — create one ---
    exporter = OTLPSpanExporter(
        endpoint=otlp_endpoint,
        headers={"Authorization": make_auth_header(dt_access_token)},
    )
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    _configured_params = {
        "dt_endpoint": normalised_endpoint,
        "dt_access_token": token_hash,
        "service_name": service_name,
    }
    _configured_provider = provider
    return provider
