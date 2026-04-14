from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from dt_ai_ingest._sync import run_sync
from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.mlflow.utils import (
    is_aggregate_metric,
    is_non_score_metric,
    normalise_metric_name,
)
from dt_ai_ingest.schema import build_eval_result_event

if TYPE_CHECKING:
    # mlflow is an optional dependency; keep the import lazy for type hints only.
    import mlflow.models

logger = logging.getLogger(__name__)


def export_evaluation_results(
    result: mlflow.models.EvaluationResult,
    client: DynatraceClient,
    *,
    run_id: str | None = None,
    experiment: str | None = None,
    model_id: str | None = None,
    dataset_name: str | None = None,
    extra: dict[str, Any] | None = None,
    metric_allowlist: frozenset[str] | set[str] | None = None,
    metric_blocklist: frozenset[str] | set[str] | None = None,
    **eval_kwargs: Any,
) -> None:
    """Send a completed ``mlflow.evaluate()`` result to Dynatrace as BizEvents.

    Emits one ``gen_ai.evaluation.result`` BizEvent per metric so each score
    surfaces individually in the AI Observability App and can trigger its own
    workflow or alert.

    Metric filtering
    ~~~~~~~~~~~~~~~~
    Non-mean aggregate suffixes (``/p50``, ``/variance``, …) are always
    removed.  In addition, a set of **known non-score metric names**
    (``num_items``, ``total_tokens``, …) is filtered out by default so
    that counters don't leak through as evaluation scores.

    You can override the filtering with:

    * ``metric_allowlist`` — only these metric names (after normalisation)
      are exported.  Takes precedence over blocklist.
    * ``metric_blocklist`` — these metric names are filtered out (merged
      with the built-in defaults).

    Args:
        result:            Return value of ``mlflow.evaluate()``.
        client:            Configured :class:`~dt_ai_ingest.client.DynatraceClient`.
        run_id:            MLflow run ID.
        experiment:        Human-readable experiment or project name.
        model_id:          Model URI or display name, e.g. ``"runs:/<run_id>/model"``.
        dataset_name:      Evaluation dataset name or hash.
        metric_allowlist:  If given, *only* metric names in this set are exported.
        metric_blocklist:  Additional metric names to filter out (on top of
                           the built-in non-score blocklist).
        extra:             Additional key/value pairs included in every event.
        **eval_kwargs:     Forwarded verbatim to
                           :func:`~dt_ai_ingest.schema.build_eval_result_event`.

    Example::

        import mlflow
        from dt_ai_ingest.client import DynatraceClient
        from dt_ai_ingest.mlflow.evaluation import export_evaluation_results

        client = DynatraceClient(
            tenant_url="https://<env-id>.live.dynatrace.com",
            access_token="dt0c01.***",
        )

        with mlflow.start_run() as run:
            result = mlflow.evaluate(
                model="runs:/<run_id>/model",
                data=eval_df,
                targets="ground_truth",
                model_type="question-answering",
            )
            export_evaluation_results(
                result,
                client,
                run_id=run.info.run_id,
                experiment="my-rag-eval",
                eval_method="llm_as_judge",
                provider_name="openai",
                request_model="gpt-4.1-mini",
            )
    """
    # Merge user-supplied blocklist with defaults when no allowlist is given.
    effective_blocklist = metric_blocklist  # is_non_score_metric uses default if None

    # Keep only numeric aggregate (mean) metrics; skip string/artifact entries
    # and non-mean aggregates (p50, variance, …).
    metrics: dict[str, float] = {}
    for raw_name, value in result.metrics.items():
        if not isinstance(value, (int, float)):
            continue
        if is_aggregate_metric(raw_name):
            continue
        clean_name = normalise_metric_name(raw_name)
        if is_non_score_metric(
            clean_name,
            blocklist=effective_blocklist,
            allowlist=metric_allowlist,
        ):
            continue
        metrics[clean_name] = float(value)

    # Build MLflow context fields shared across all events for this run.
    mlflow_ctx = {
        "event.provider": "mlflow",
        "mlflow.run_id": run_id,
        "mlflow.experiment": experiment,
        "mlflow.model_id": model_id,
        "mlflow.dataset_name": dataset_name,
    }
    shared_extra = {k: v for k, v in mlflow_ctx.items() if v is not None}
    if extra:
        shared_extra.update(extra)

    events = [
        build_eval_result_event(
            eval_name=name,
            score_value=value,
            extra=shared_extra or None,
            **eval_kwargs,
        )
        for name, value in metrics.items()
    ]

    if events:
        run_sync(client.send_bizevents(events))
    else:
        logger.warning(
            "No exportable metrics found after filtering — nothing sent to Dynatrace. "
            "Check metric_allowlist / metric_blocklist settings."
        )
