"""Export DeepEval test results to Dynatrace as BizEvents."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from dt_ai_ingest._sync import run_sync
from dt_ai_ingest._utils import safe_float
from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.schema import build_eval_result_event

if TYPE_CHECKING:
    from deepeval.evaluate.types import EvaluationResult

logger = logging.getLogger(__name__)


def export_deepeval_results(
    result: EvaluationResult,
    client: DynatraceClient,
    *,
    test_run_name: str | None = None,
    dataset_name: str | None = None,
    extra: dict[str, Any] | None = None,
    **eval_kwargs: Any,
) -> None:
    """Send DeepEval test results to Dynatrace as BizEvents.

    Emits one ``gen_ai.evaluation.result`` BizEvent per metric per test case.
    Each event captures the metric score, pass/fail status, threshold, and
    DeepEval-specific context fields.

    Args:
        result:         Return value of ``deepeval.evaluate()``.
        client:         Configured :class:`~dt_ai_ingest.client.DynatraceClient`.
        test_run_name:  Human-readable name for this test run.
        dataset_name:   Dataset identifier.
        extra:          Additional key/value pairs included in every event.
        **eval_kwargs:  Forwarded verbatim to
                        :func:`~dt_ai_ingest.schema.build_eval_result_event`.
                        Use this for ``eval_type``, ``eval_method``,
                        ``scoring_format``, ``request_model``, etc.

    Example::

        from deepeval import evaluate
        from deepeval.metrics import AnswerRelevancyMetric
        from deepeval.test_case import LLMTestCase
        from dt_ai_ingest.client import DynatraceClient
        from dt_ai_ingest.deepeval import export_deepeval_results

        test_case = LLMTestCase(input="...", actual_output="...")
        result = evaluate([test_case], [AnswerRelevancyMetric()])

        client = DynatraceClient(
            tenant_url="https://<env-id>.live.dynatrace.com",
            access_token="dt0c01.***",
        )
        export_deepeval_results(result, client, test_run_name="my-eval")
    """
    test_results = result.test_results
    if not test_results:
        logger.warning("DeepEval EvaluationResult has no test results — nothing to export.")
        return

    # Build shared context fields.
    test_run_id = getattr(result, "test_run_id", None)
    num_test_cases = len(test_results)

    shared_ctx: dict[str, Any] = {
        "event.provider": "deepeval",
        "deepeval.num_test_cases": num_test_cases,
    }
    if test_run_id is not None:
        shared_ctx["deepeval.test_run_id"] = test_run_id
    if test_run_name is not None:
        shared_ctx["deepeval.test_run_name"] = test_run_name
    if dataset_name is not None:
        shared_ctx["deepeval.dataset_name"] = dataset_name

    # Merge user-supplied extra on top.
    if extra:
        shared_ctx.update(extra)

    events = _build_events(test_results, shared_ctx, eval_kwargs)

    if events:
        run_sync(client.send_bizevents(events))
    else:
        logger.warning("No metric results found in DeepEval test results — nothing to export.")


def _build_events(
    test_results: list[Any],
    shared_ctx: dict[str, Any],
    eval_kwargs: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build one BizEvent per metric per test case."""
    events: list[dict[str, Any]] = []

    for tc_idx, test_result in enumerate(test_results):
        metrics_data = getattr(test_result, "metrics_data", None)
        if not metrics_data:
            continue

        tc_name = getattr(test_result, "name", None) or f"test_case_{tc_idx}"
        tc_success = getattr(test_result, "success", None)
        tc_conversational = getattr(test_result, "conversational", False)

        for metric in metrics_data:
            metric_name = getattr(metric, "name", None)
            if metric_name is None:
                continue

            score = safe_float(getattr(metric, "score", None))
            metric_success = getattr(metric, "success", None)
            threshold = safe_float(getattr(metric, "threshold", None))
            evaluation_model = getattr(metric, "evaluation_model", None)
            error = getattr(metric, "error", None)

            # Determine score_label (pass/fail)
            score_label: str | None = None
            if metric_success is True:
                score_label = "pass"
            elif metric_success is False:
                score_label = "fail"

            # Build per-event extra context.
            event_extra: dict[str, Any] = {
                **shared_ctx,
                "deepeval.test_case_name": tc_name,
                "deepeval.test_case_index": tc_idx,
                "deepeval.conversational": tc_conversational,
            }
            if tc_success is not None:
                event_extra["deepeval.test_case_success"] = tc_success
            if metric_success is not None:
                event_extra["deepeval.metric_success"] = metric_success
            if threshold is not None:
                event_extra["deepeval.metric_threshold"] = threshold
            if evaluation_model is not None:
                event_extra["deepeval.evaluation_model"] = evaluation_model
            if error is not None:
                event_extra["deepeval.metric_error"] = error

            # Build kwargs for build_eval_result_event.
            build_kwargs: dict[str, Any] = {**eval_kwargs}
            if score_label is not None:
                build_kwargs["score_label"] = score_label

            # A metric that errored has score=None; the event is still emitted
            # (with its pass/fail label) — build_eval_result_event omits the
            # numeric score key when score_value is None.
            events.append(
                build_eval_result_event(
                    eval_name=metric_name,
                    score_value=score,
                    extra=event_extra,
                    **build_kwargs,
                )
            )

    return events
