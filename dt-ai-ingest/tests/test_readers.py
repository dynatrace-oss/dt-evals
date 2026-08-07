"""Tests for the csv / jsonl / json readers."""

from __future__ import annotations

import json

import pytest

from dt_ai_ingest.readers import rows_to_evals


def test_jsonl(tmp_path):
    path = tmp_path / "e.jsonl"
    path.write_text('{"name":"a","score":0.5}\n\n{"name":"b","score":1.0}\n')
    evals = list(rows_to_evals(path))
    assert [e.name for e in evals] == ["a", "b"]
    assert evals[0].score == 0.5


def test_json_array(tmp_path):
    path = tmp_path / "e.json"
    path.write_text(json.dumps([{"name": "a", "score": 0.1}]))
    assert list(rows_to_evals(path))[0].name == "a"


def test_csv_mapping_defaults_and_extra(tmp_path):
    path = tmp_path / "e.csv"
    path.write_text("metric,rating,notes\nfaith,0.87,good\n")
    evals = list(
        rows_to_evals(
            path,
            mapping={"metric": "name", "rating": "score"},
            defaults={"method": "regex"},
        )
    )
    ev = evals[0]
    assert ev.name == "faith"
    assert ev.score == 0.87  # CSV string coerced to float by Pydantic
    assert ev.method == "regex"
    assert ev.extra == {"notes": "good"}


def test_csv_native_column_names(tmp_path):
    """Columns named after Eval fields (span_id, trace_id, etc.) need no mapping."""
    path = tmp_path / "e.csv"
    path.write_text(
        "name,score,label,trace_id,span_id,run_id,model_provider\n"
        "faithfulness,0.9,pass,traceval,spanval,run-1,openai\n"
    )
    ev = list(rows_to_evals(path))[0]
    assert ev.name == "faithfulness"
    assert ev.trace_id == "traceval"
    assert ev.span_id == "spanval"
    assert ev.run_id == "run-1"
    assert ev.model_provider == "openai"


def test_blank_csv_cell_is_absent(tmp_path):
    path = tmp_path / "e.csv"
    path.write_text("name,score\nfoo,\n")
    assert list(rows_to_evals(path))[0].score is None


def test_parquet(tmp_path):
    pa = pytest.importorskip("pyarrow")
    import pyarrow.parquet as pq

    table = pa.table({
        "name": ["faithfulness", "toxicity", "helpfulness"],
        "score": [0.92, 0.0, 4.0],
        "label": ["pass", "pass", "pass"],
        "scoring_format": ["score_0_to_1", "score_0_to_1", "score_1_to_5"],
        "model_provider": ["openai", "openai", "openai"],
        "run_id": ["run-1", "run-1", "run-1"],
    })
    path = tmp_path / "e.parquet"
    pq.write_table(table, path)

    evals = list(rows_to_evals(path))
    assert len(evals) == 3
    assert evals[0].name == "faithfulness"
    assert evals[0].score == 0.92
    assert evals[0].model_provider == "openai"
    assert evals[2].scoring_format == "score_1_to_5"
    assert evals[2].score == 4.0


def test_parquet_nulls_are_absent(tmp_path):
    pa = pytest.importorskip("pyarrow")
    import pyarrow.parquet as pq

    table = pa.table({
        "name": ["x"],
        "score": pa.array([None], type=pa.float64()),
    })
    pq.write_table(table, tmp_path / "e.parquet")
    ev = list(rows_to_evals(tmp_path / "e.parquet"))[0]
    assert ev.score is None


def test_unsupported_file_type(tmp_path):
    path = tmp_path / "e.txt"
    path.write_text("x")
    with pytest.raises(ValueError, match="unsupported file type"):
        list(rows_to_evals(path))
