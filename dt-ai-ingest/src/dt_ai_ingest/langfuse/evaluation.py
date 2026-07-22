"""Export Langfuse evaluation scores to Dynatrace as BizEvents."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from dt_ai_ingest._sync import run_sync
from dt_ai_ingest._utils import safe_float
from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.schema import build_eval_result_event

if TYPE_CHECKING:
    from langfuse import Langfuse

logger = logging.getLogger(__name__)

# Page size for Langfuse API pagination.
_PAGE_SIZE = 100


def export_langfuse_scores(
    langfuse_client: Langfuse,
    dt_client: DynatraceClient,
    *,
    trace_ids: list[str] | None = None,
    score_name: str | None = None,
    include_comments: bool = False,
    extra: dict[str, Any] | None = None,
    **eval_kwargs: Any,
) -> None:
    """Fetch Langfuse scores and send them to Dynatrace as BizEvents.

    Connects to the Langfuse API, fetches evaluation scores matching the
    given filters, and exports each as a ``gen_ai.evaluation.result``
    BizEvent to Dynatrace.

    All three Langfuse score data types are supported:

    - **NUMERIC** — ``score_value`` is the float value.
    - **BOOLEAN** — ``score_value`` is ``1.0`` (True) or ``0.0`` (False),
      ``score_label`` is ``"True"`` or ``"False"``.
    - **CATEGORICAL** — ``score_label`` is the string category.
      ``score_value`` is the numeric mapping (defaults to ``0`` if no
      config is linked).

    Args:
        langfuse_client:  Configured :class:`~langfuse.Langfuse` instance.
        dt_client:        Configured :class:`~dt_ai_ingest.client.DynatraceClient`.
        trace_ids:        Only export scores linked to these Langfuse trace IDs.
                          If ``None``, all scores are fetched (subject to
                          ``score_name`` filter).
        score_name:       Only export scores with this name.
        include_comments: When ``True``, include the score's ``comment``
                          field as ``langfuse.score_comment``.
        extra:            Additional key/value pairs included in every event.
        **eval_kwargs:    Forwarded verbatim to
                          :func:`~dt_ai_ingest.schema.build_eval_result_event`.
                          Use this for ``eval_type``, ``eval_method``,
                          ``scoring_format``, ``request_model``, etc.

    Example::

        from langfuse import Langfuse
        from dt_ai_ingest.client import DynatraceClient
        from dt_ai_ingest.langfuse import export_langfuse_scores

        langfuse = Langfuse()
        dt = DynatraceClient(
            tenant_url="https://<env-id>.live.dynatrace.com",
            access_token="dt0c01.***",
        )
        export_langfuse_scores(
            langfuse,
            dt,
            trace_ids=["trace-abc-123"],
            score_name="faithfulness",
        )
    """
    scores = _fetch_scores(langfuse_client, trace_ids=trace_ids, score_name=score_name)

    if not scores:
        logger.warning("No Langfuse scores found matching filters — nothing to export.")
        return

    events = _build_events(
        scores, include_comments=include_comments, extra=extra, eval_kwargs=eval_kwargs
    )

    if events:
        run_sync(dt_client.send_bizevents(events))
    else:
        logger.warning("No valid scores to export after processing — nothing to export.")


def _fetch_scores(
    langfuse_client: Langfuse,
    *,
    trace_ids: list[str] | None = None,
    score_name: str | None = None,
) -> list[Any]:
    """Fetch scores from Langfuse API with pagination.

    If ``trace_ids`` is provided, makes one paginated query per trace ID
    (the API accepts a single ``trace_id`` string, not a list).
    """
    if trace_ids is not None:
        all_scores: list[Any] = []
        for tid in trace_ids:
            all_scores.extend(
                _fetch_scores_paginated(langfuse_client, trace_id=tid, score_name=score_name)
            )
        return all_scores
    else:
        return _fetch_scores_paginated(langfuse_client, trace_id=None, score_name=score_name)


def _fetch_scores_paginated(
    langfuse_client: Langfuse,
    *,
    trace_id: str | None = None,
    score_name: str | None = None,
) -> list[Any]:
    """Paginate through Langfuse scores API."""
    all_scores: list[Any] = []
    page = 1

    while True:
        kwargs: dict[str, Any] = {"page": page, "limit": _PAGE_SIZE}
        if trace_id is not None:
            kwargs["trace_id"] = trace_id
        if score_name is not None:
            kwargs["name"] = score_name

        # Langfuse v4 uses .api.scores.get_many(), v3 used .api.score_v_2.get()
        api = getattr(langfuse_client, "api", None)
        if api is None:
            raise AttributeError(
                "Langfuse client has no API access. "
                "Ensure LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set."
            )
        if hasattr(api, "scores"):
            response = api.scores.get_many(**kwargs)
        else:
            response = api.score_v_2.get(**kwargs)
        all_scores.extend(response.data)

        if page >= response.meta.total_pages:
            break
        page += 1

    return all_scores


def _build_events(
    scores: list[Any],
    *,
    include_comments: bool,
    extra: dict[str, Any] | None,
    eval_kwargs: dict[str, Any],
) -> list[dict[str, Any]]:
    """Convert Langfuse score objects to BizEvent dicts."""
    events: list[dict[str, Any]] = []

    for score in scores:
        name = getattr(score, "name", None)
        if name is None:
            continue

        data_type = getattr(score, "data_type", "NUMERIC")
        value = safe_float(getattr(score, "value", None))
        string_value = getattr(score, "string_value", None)

        # Build Langfuse context fields.
        score_extra: dict[str, Any] = {"event.provider": "langfuse"}

        score_id = getattr(score, "id", None)
        if score_id is not None:
            score_extra["langfuse.score_id"] = score_id

        source = getattr(score, "source", None)
        if source is not None:
            # ScoreSource is an enum; use .value for the string
            score_extra["langfuse.score_source"] = (
                source.value if hasattr(source, "value") else str(source)
            )

        score_extra["langfuse.data_type"] = data_type

        # Trace linkage — both as OTel schema fields (via build kwargs) and langfuse.* extra
        trace_id = getattr(score, "trace_id", None)
        observation_id = getattr(score, "observation_id", None)
        if trace_id is not None:
            score_extra["langfuse.trace_id"] = trace_id
        if observation_id is not None:
            score_extra["langfuse.observation_id"] = observation_id

        session_id = getattr(score, "session_id", None)
        if session_id is not None:
            score_extra["langfuse.session_id"] = session_id

        config_id = getattr(score, "config_id", None)
        if config_id is not None:
            score_extra["langfuse.config_id"] = config_id

        # Optional comment (PII opt-in)
        if include_comments:
            comment = getattr(score, "comment", None)
            if comment is not None:
                score_extra["langfuse.score_comment"] = comment

        # Merge user-supplied extra on top.
        if extra:
            score_extra.update(extra)

        # Build kwargs for build_eval_result_event (including OTel trace linkage).
        build_kwargs: dict[str, Any] = {**eval_kwargs}
        if trace_id is not None:
            build_kwargs["trace_id"] = trace_id
        if observation_id is not None:
            build_kwargs["span_id"] = observation_id

        # Handle score types.
        if data_type == "BOOLEAN":
            # Boolean: value is 0 or 1, string_value is "True"/"False"
            score_label = (
                string_value if string_value is not None else ("True" if value == 1.0 else "False")
            )
            build_kwargs["score_label"] = score_label
            # value may be None (no numeric score); the builder omits the
            # numeric score key in that case and still emits the label.
            events.append(
                build_eval_result_event(
                    eval_name=name,
                    score_value=value,
                    extra=score_extra,
                    **build_kwargs,
                )
            )

        elif data_type == "CATEGORICAL":
            # Categorical: string_value is the category, value may be numeric mapping (default 0)
            if string_value is not None:
                build_kwargs["score_label"] = string_value
            # value may be None (no numeric mapping); the builder omits the
            # numeric score key in that case and still emits the label.
            events.append(
                build_eval_result_event(
                    eval_name=name,
                    score_value=value,
                    extra=score_extra,
                    **build_kwargs,
                )
            )

        else:
            # NUMERIC (default) — straightforward
            if value is not None:
                events.append(
                    build_eval_result_event(
                        eval_name=name,
                        score_value=value,
                        extra=score_extra,
                        **build_kwargs,
                    )
                )
            else:
                logger.debug("Skipping score %r with no numeric value.", name)

    return events
