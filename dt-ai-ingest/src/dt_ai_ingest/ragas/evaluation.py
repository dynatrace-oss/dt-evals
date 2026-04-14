"""Export Ragas EvaluationResult scores to Dynatrace as BizEvents."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from dt_ai_ingest._sync import run_sync
from dt_ai_ingest._utils import safe_float
from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.schema import build_eval_result_event

if TYPE_CHECKING:
    import ragas

logger = logging.getLogger(__name__)


def _extract_metric_names(scores: list[dict[str, Any]]) -> list[str]:
    """Return the unique metric names across all sample score dicts."""
    names: dict[str, None] = {}  # ordered set via dict
    for sample in scores:
        for key in sample:
            if key not in names:
                names[key] = None
    return list(names)


def _aggregate_scores(
    scores: list[dict[str, Any]],
    metric_names: list[str],
) -> dict[str, float]:
    """Compute the mean score per metric, skipping NaN values.

    Returns a dict of ``{metric_name: mean_score}`` — only metrics with
    at least one valid (non-NaN) score are included.
    """
    aggregated: dict[str, float] = {}
    for name in metric_names:
        valid_values: list[float] = []
        for sample in scores:
            val = safe_float(sample.get(name))
            if val is not None:
                valid_values.append(val)
        if valid_values:
            aggregated[name] = sum(valid_values) / len(valid_values)
    return aggregated


def export_ragas_results(
    result: ragas.EvaluationResult,
    client: DynatraceClient,
    *,
    dataset_name: str | None = None,
    experiment_name: str | None = None,
    per_sample: bool = False,
    extra: dict[str, Any] | None = None,
    **eval_kwargs: Any,
) -> None:
    """Send Ragas evaluation scores to Dynatrace as BizEvents.

    By default emits one ``gen_ai.evaluation.result`` BizEvent per metric
    with the mean score across all samples.  Set ``per_sample=True`` to
    emit one event per metric *per sample* for detailed analysis.

    Args:
        result:           Return value of ``ragas.evaluate()`` or ``ragas.aevaluate()``.
        client:           Configured :class:`~dt_ai_ingest.client.DynatraceClient`.
        dataset_name:     Human-readable dataset identifier.
        experiment_name:  Experiment or project name.  Falls back to
                          ``result.run_id`` if not provided.
        per_sample:       When ``True``, emit one BizEvent per metric per sample
                          instead of one per metric with mean score.
        extra:            Additional key/value pairs included in every event.
        **eval_kwargs:    Forwarded verbatim to
                          :func:`~dt_ai_ingest.schema.build_eval_result_event`.
                          Use this for ``eval_type``, ``eval_method``,
                          ``scoring_format``, ``request_model``, etc.

    Example::

        from ragas import evaluate
        from ragas.metrics import faithfulness, answer_relevancy
        from dt_ai_ingest.client import DynatraceClient
        from dt_ai_ingest.ragas import export_ragas_results

        result = evaluate(dataset, metrics=[faithfulness, answer_relevancy])

        client = DynatraceClient(
            tenant_url="https://<env-id>.live.dynatrace.com",
            access_token="dt0c01.***",
        )
        export_ragas_results(
            result,
            client,
            dataset_name="my-qa-dataset",
            experiment_name="rag-eval-v1",
        )
    """
    scores: list[dict[str, Any]] = result.scores
    if not scores:
        logger.warning("Ragas EvaluationResult has no scores — nothing to export.")
        return

    # Build Ragas context fields shared across all events.
    run_id = str(result.run_id) if getattr(result, "run_id", None) is not None else None
    num_samples = len(scores)
    effective_experiment = experiment_name or run_id

    ragas_ctx: dict[str, Any] = {
        "event.provider": "ragas",
        "ragas.num_samples": num_samples,
    }
    if dataset_name is not None:
        ragas_ctx["ragas.dataset_name"] = dataset_name
    if effective_experiment is not None:
        ragas_ctx["ragas.experiment_name"] = effective_experiment
    if run_id is not None:
        ragas_ctx["ragas.run_id"] = run_id

    # Merge user-supplied extra on top of ragas context.
    shared_extra = {**ragas_ctx}
    if extra:
        shared_extra.update(extra)

    metric_names = _extract_metric_names(scores)

    if per_sample:
        events = _build_per_sample_events(scores, metric_names, shared_extra, eval_kwargs)
    else:
        events = _build_aggregate_events(scores, metric_names, shared_extra, eval_kwargs)

    if events:
        run_sync(client.send_bizevents(events))
    else:
        logger.warning("No valid (non-NaN) scores found — nothing to export.")


def _build_aggregate_events(
    scores: list[dict[str, Any]],
    metric_names: list[str],
    shared_extra: dict[str, Any],
    eval_kwargs: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build one BizEvent per metric with the mean score."""
    aggregated = _aggregate_scores(scores, metric_names)
    return [
        build_eval_result_event(
            eval_name=name,
            score_value=mean_score,
            extra=shared_extra or None,
            **eval_kwargs,
        )
        for name, mean_score in aggregated.items()
    ]


def _build_per_sample_events(
    scores: list[dict[str, Any]],
    metric_names: list[str],
    shared_extra: dict[str, Any],
    eval_kwargs: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build one BizEvent per metric per sample."""
    events: list[dict[str, Any]] = []
    for sample_idx, sample in enumerate(scores):
        for name in metric_names:
            value = safe_float(sample.get(name))
            if value is None:
                continue
            sample_extra = {
                **shared_extra,
                "ragas.sample_index": sample_idx,
            }
            events.append(
                build_eval_result_event(
                    eval_name=name,
                    score_value=value,
                    extra=sample_extra,
                    **eval_kwargs,
                )
            )
    return events
