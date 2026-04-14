"""MLflow-specific mapping logic for Dynatrace eval events."""

from __future__ import annotations

# MLflow appends "/mean", "/p50", "/variance" suffixes to aggregate metrics.
_MLFLOW_STAT_SUFFIXES = ("/mean", "/p50", "/p90", "/p99", "/variance", "/std")

# Known non-score metric names that MLflow emits as numeric values but
# are *not* evaluation scores.  These are count/size metrics that should
# not become ``gen_ai.evaluation.result`` BizEvents.
#
# The check is performed on the **normalised** name (after stripping
# ``/mean``), case-insensitively.
DEFAULT_METRIC_BLOCKLIST: frozenset[str] = frozenset(
    {
        "num_items",
        "num_examples",
        "num_rows",
        "total_tokens",
        "input_tokens",
        "output_tokens",
        "prompt_tokens",
        "completion_tokens",
        "latency",
        "duration",
        "execution_time",
        "token_count",
    }
)


def normalise_metric_name(name: str) -> str:
    """Strip the ``/mean`` suffix that MLflow appends to aggregate metrics.

    ``exact_match/mean`` → ``exact_match``, while names without the suffix
    (or with other stat suffixes like ``/p50``) are returned unchanged.
    """
    if name.endswith("/mean"):
        return name[: -len("/mean")]
    return name


def is_aggregate_metric(name: str) -> bool:
    """Return True for non-mean aggregate metrics (p50, variance, etc.)."""
    return any(name.endswith(s) for s in _MLFLOW_STAT_SUFFIXES if s != "/mean")


def is_non_score_metric(
    normalised_name: str,
    *,
    blocklist: frozenset[str] | set[str] | None = None,
    allowlist: frozenset[str] | set[str] | None = None,
) -> bool:
    """Return True if *normalised_name* is a non-score metric that should be filtered out.

    Evaluation order:

    1. If *allowlist* is provided and the name is **in** the allowlist → keep (return False).
    2. If *allowlist* is provided and the name is **not** in the allowlist → filter (return True).
    3. If *blocklist* is provided (or the default is used) and the name is **in** it → filter (return True).
    4. Otherwise → keep (return False).

    Both comparisons are case-insensitive.

    Args:
        normalised_name: Metric name after :func:`normalise_metric_name`.
        blocklist:       Explicit blocklist; defaults to :data:`DEFAULT_METRIC_BLOCKLIST`.
        allowlist:        If provided, only metrics in this set are kept.
    """
    lower = normalised_name.lower()

    if allowlist is not None:
        return lower not in {a.lower() for a in allowlist}

    effective_blocklist = blocklist if blocklist is not None else DEFAULT_METRIC_BLOCKLIST
    return lower in {b.lower() for b in effective_blocklist}
