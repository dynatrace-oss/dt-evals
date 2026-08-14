"""Tests for from_ragas, using a fake EvaluationResult (no ragas install)."""

from __future__ import annotations

import math

from dt_ai_ingest.integrations.ragas import from_ragas


class _FakeDataFrame:
    def __init__(self, records: list[dict]):
        self._records = records

    def to_dict(self, orient: str = "records") -> list[dict]:
        assert orient == "records"
        return [dict(r) for r in self._records]


class _FakeResult:
    def __init__(
        self,
        records: list[dict],
        scores: list[dict] | None,
        binary_columns: list[str] | None = None,
    ):
        self._records = records
        self.scores = scores
        self.binary_columns = binary_columns or []

    def to_pandas(self) -> _FakeDataFrame:
        return _FakeDataFrame(self._records)


def _sample_result(scores_attr: bool = True) -> _FakeResult:
    records = [
        {
            "user_input": "What is Grail?",
            "response": "A data lakehouse.",
            "retrieved_contexts": ["doc-1", "doc-2"],
            "faithfulness": 1.0,
            "answer_relevancy": 0.8,
        },
        {
            "user_input": "What is DQL?",
            "response": "A query language.",
            "retrieved_contexts": ["doc-3"],
            "faithfulness": float("nan"),
            "answer_relevancy": 0.5,
        },
    ]
    scores = [
        {"faithfulness": 1.0, "answer_relevancy": 0.8},
        {"faithfulness": float("nan"), "answer_relevancy": 0.5},
    ]
    return _FakeResult(records, scores if scores_attr else None)


def test_fans_out_one_eval_per_sample_metric():
    evals = from_ragas(_sample_result())
    assert len(evals) == 3
    assert sorted(e.name for e in evals) == [
        "answer_relevancy",
        "answer_relevancy",
        "faithfulness",
    ]


def test_maps_question_and_answer_and_drops_contexts():
    first = next(e for e in from_ragas(_sample_result()) if e.name == "faithfulness")
    assert first.question == "What is Grail?"
    assert first.answer == "A data lakehouse."
    assert first.score == 1.0
    assert "retrieved_contexts" not in first.extra


def test_nan_scores_are_skipped():
    evals = from_ragas(_sample_result())
    assert len([e for e in evals if e.name == "faithfulness"]) == 1
    assert all(e.score is not None and not math.isnan(e.score) for e in evals)


def test_run_id_stamped_on_every_eval():
    evals = from_ragas(_sample_result(), run_id="golden-set-v1")
    assert {e.run_id for e in evals} == {"golden-set-v1"}


def test_defaults_applied_to_every_eval():
    evals = from_ragas(
        _sample_result(), defaults={"model": "gpt-4o", "model_provider": "openai"}
    )
    assert all(e.model == "gpt-4o" and e.model_provider == "openai" for e in evals)


def test_mapping_passthrough_to_extra():
    evals = from_ragas(_sample_result(), mapping={"retrieved_contexts": "rag.contexts"})
    assert evals[0].extra["rag.contexts"] == ["doc-1", "doc-2"]


def test_metric_detection_falls_back_without_scores_attr():
    evals = from_ragas(_sample_result(scores_attr=False))
    assert len(evals) == 3
    assert {e.name for e in evals} == {"faithfulness", "answer_relevancy"}


def test_empty_result_yields_no_evals():
    assert from_ragas(_FakeResult([], [])) == []


def test_binary_metric_gets_pass_fail_label():
    result = _FakeResult(
        records=[
            {"user_input": "q1", "response": "a1", "conciseness": 1},
            {"user_input": "q2", "response": "a2", "conciseness": 0},
        ],
        scores=[{"conciseness": 1}, {"conciseness": 0}],
        binary_columns=["conciseness"],
    )
    evals = from_ragas(result)
    assert [(e.score, e.label) for e in evals] == [(1.0, "pass"), (0.0, "fail")]
    assert all(e.scoring_format == "score_0_to_1" for e in evals)


def test_rubric_metric_uses_rubric_scoring_format():
    result = _FakeResult(
        records=[
            {"user_input": "q1", "response": "a1", "correctness": 5},
            {"user_input": "q2", "response": "a2", "correctness": 3},
        ],
        scores=[{"correctness": 5}, {"correctness": 3}],
    )
    evals = from_ragas(result)
    assert [e.score for e in evals] == [5.0, 3.0]
    assert all(e.scoring_format == "rubric" and e.label is None for e in evals)
