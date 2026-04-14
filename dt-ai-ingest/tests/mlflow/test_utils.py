"""Unit tests for dt_ai_ingest.mlflow.utils."""

from dt_ai_ingest.mlflow.utils import (
    DEFAULT_METRIC_BLOCKLIST,
    is_aggregate_metric,
    is_non_score_metric,
    normalise_metric_name,
)


class TestNormaliseMetricName:
    def test_strips_mean_suffix(self):
        assert normalise_metric_name("exact_match/mean") == "exact_match"

    def test_keeps_p50_suffix(self):
        assert normalise_metric_name("latency/p50") == "latency/p50"

    def test_keeps_variance_suffix(self):
        assert normalise_metric_name("score/variance") == "score/variance"

    def test_no_suffix(self):
        assert normalise_metric_name("exact_match") == "exact_match"

    def test_name_with_mean_in_it(self):
        assert normalise_metric_name("mean_score") == "mean_score"


class TestIsAggregateMetric:
    def test_mean_is_not_aggregate(self):
        assert is_aggregate_metric("exact_match/mean") is False

    def test_p50_is_aggregate(self):
        assert is_aggregate_metric("latency/p50") is True

    def test_p90_is_aggregate(self):
        assert is_aggregate_metric("latency/p90") is True

    def test_variance_is_aggregate(self):
        assert is_aggregate_metric("score/variance") is True

    def test_std_is_aggregate(self):
        assert is_aggregate_metric("score/std") is True

    def test_no_suffix_not_aggregate(self):
        assert is_aggregate_metric("exact_match") is False


class TestIsNonScoreMetric:
    """Tests for the non-score metric blocklist filtering."""

    def test_num_items_blocked_by_default(self):
        assert is_non_score_metric("num_items") is True

    def test_num_examples_blocked_by_default(self):
        assert is_non_score_metric("num_examples") is True

    def test_total_tokens_blocked_by_default(self):
        assert is_non_score_metric("total_tokens") is True

    def test_input_tokens_blocked_by_default(self):
        assert is_non_score_metric("input_tokens") is True

    def test_output_tokens_blocked_by_default(self):
        assert is_non_score_metric("output_tokens") is True

    def test_latency_blocked_by_default(self):
        assert is_non_score_metric("latency") is True

    def test_score_metric_not_blocked(self):
        assert is_non_score_metric("exact_match") is False

    def test_faithfulness_not_blocked(self):
        assert is_non_score_metric("faithfulness") is False

    def test_relevance_not_blocked(self):
        assert is_non_score_metric("relevance") is False

    def test_case_insensitive(self):
        assert is_non_score_metric("NUM_ITEMS") is True
        assert is_non_score_metric("Num_Items") is True

    def test_custom_blocklist_overrides_default(self):
        # Custom blocklist replaces default; "num_items" not in custom list → passes
        assert is_non_score_metric("num_items", blocklist={"my_bad_metric"}) is False
        assert is_non_score_metric("my_bad_metric", blocklist={"my_bad_metric"}) is True

    def test_allowlist_takes_precedence(self):
        # With an allowlist, ONLY listed metrics pass
        assert is_non_score_metric("exact_match", allowlist={"exact_match"}) is False
        assert is_non_score_metric("faithfulness", allowlist={"exact_match"}) is True
        # Even default-blocked metrics pass if they're in the allowlist
        assert is_non_score_metric("num_items", allowlist={"num_items"}) is False

    def test_allowlist_case_insensitive(self):
        assert is_non_score_metric("Exact_Match", allowlist={"exact_match"}) is False

    def test_empty_allowlist_blocks_everything(self):
        assert is_non_score_metric("exact_match", allowlist=set()) is True

    def test_default_blocklist_has_expected_entries(self):
        """Sanity check: the built-in blocklist has the important non-score names."""
        expected = {"num_items", "num_examples", "total_tokens", "latency", "token_count"}
        assert expected.issubset(DEFAULT_METRIC_BLOCKLIST)
