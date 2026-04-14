"""dt_ai_ingest — ship AI evaluation results to Dynatrace Grail as BizEvents."""

from dt_ai_ingest._otel import configure_tracing
from dt_ai_ingest._sync import run_sync
from dt_ai_ingest.auth import make_auth_header
from dt_ai_ingest.client import DynatraceClient
from dt_ai_ingest.schema import EvalEvent, build_eval_result_event

__all__ = [
    "DynatraceClient",
    "EvalEvent",
    "build_eval_result_event",
    "configure_tracing",
    "make_auth_header",
    "run_sync",
]
