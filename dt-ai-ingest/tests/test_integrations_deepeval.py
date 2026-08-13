"""Tests for from_deepeval, using a fake EvaluationResult (no deepeval install)."""

from __future__ import annotations

from dt_ai_ingest.integrations.deepeval import from_deepeval


class _FakeMetric:
    def __init__(
        self,
        name: str,
        score: float | None,
        success: bool | None = None,
        reason: str | None = None,
        evaluation_model: str | None = None,
    ):
        self.name = name
        self.score = score
        self.success = success
        self.reason = reason
        self.evaluation_model = evaluation_model


class _FakeTestResult:
    def __init__(self, input, actual_output, metrics_data, **extra):
        self.input = input
        self.actual_output = actual_output
        self.metrics_data = metrics_data
        self.expected_output = extra.get("expected_output")
        self.retrieval_context = extra.get("retrieval_context")


class _FakeResult:
    def __init__(self, test_results, test_run_id=None):
        self.test_results = test_results
        self.test_run_id = test_run_id


def _sample_result() -> _FakeResult:
    return _FakeResult(
        test_results=[
            _FakeTestResult(
                input="What is Grail?",
                actual_output="A data lakehouse.",
                retrieval_context=["doc-1", "doc-2"],
                metrics_data=[
                    _FakeMetric("answer_relevancy", 0.9, True, "on topic", "gpt-4o"),
                    _FakeMetric("faithfulness", 0.4, False, "unsupported claim", "gpt-4o"),
                ],
            ),
            _FakeTestResult(
                input="What is DQL?",
                actual_output="A query language.",
                metrics_data=[
                    _FakeMetric("answer_relevancy", 0.8, True),
                ],
            ),
        ],
    )


def test_fans_out_one_eval_per_test_case_metric():
    evals = from_deepeval(_sample_result())
    assert len(evals) == 3
    assert sorted(e.name for e in evals) == [
        "answer_relevancy",
        "answer_relevancy",
        "faithfulness",
    ]


def test_maps_input_and_output_and_score():
    faith = next(e for e in from_deepeval(_sample_result()) if e.name == "faithfulness")
    assert faith.question == "What is Grail?"
    assert faith.answer == "A data lakehouse."
    assert faith.score == 0.4
    assert faith.scoring_format == "score_0_to_1"


def test_success_becomes_pass_fail_label():
    evals = from_deepeval(_sample_result())
    by_name = {(e.name, e.score): e.label for e in evals}
    assert by_name[("answer_relevancy", 0.9)] == "pass"
    assert by_name[("faithfulness", 0.4)] == "fail"


def test_reason_and_model_are_carried_over():
    faith = next(e for e in from_deepeval(_sample_result()) if e.name == "faithfulness")
    assert faith.explanation == "unsupported claim"
    assert faith.model == "gpt-4o"


def test_metric_without_score_is_skipped():
    result = _FakeResult(
        test_results=[
            _FakeTestResult(
                input="q",
                actual_output="a",
                metrics_data=[
                    _FakeMetric("errored", None),
                    _FakeMetric("ok", 0.7, True),
                ],
            )
        ]
    )
    evals = from_deepeval(result)
    assert [e.name for e in evals] == ["ok"]


def test_run_id_explicit_overrides_test_run_id():
    result = _sample_result()
    result.test_run_id = "server-run"
    evals = from_deepeval(result, run_id="golden-set-v1")
    assert {e.run_id for e in evals} == {"golden-set-v1"}


def test_test_run_id_used_as_run_id_fallback():
    result = _sample_result()
    result.test_run_id = "server-run"
    evals = from_deepeval(result)
    assert {e.run_id for e in evals} == {"server-run"}


def test_defaults_applied_to_every_eval():
    evals = from_deepeval(_sample_result(), defaults={"model_provider": "openai"})
    assert all(e.model_provider == "openai" for e in evals)


def test_mapping_routes_extra_field_into_extra():
    evals = from_deepeval(
        _sample_result(), mapping={"retrieval_context": "rag.contexts"}
    )
    grail = next(e for e in evals if e.question == "What is Grail?")
    assert grail.extra["rag.contexts"] == ["doc-1", "doc-2"]


def test_empty_result_yields_no_evals():
    assert from_deepeval(_FakeResult([])) == []
