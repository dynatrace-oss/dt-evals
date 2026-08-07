"""Tests for scoped inline evaluation and span-id extraction."""

from __future__ import annotations

from dt_ai_ingest.scope import EvaluationScope
from dt_ai_ingest.spans import current_span_ids, span_ids


class _Ctx:
    is_valid = True
    trace_id = 0x0123456789ABCDEF0123456789ABCDEF
    span_id = 0x0123456789ABCDEF


class _Span:
    def get_span_context(self) -> _Ctx:
        return _Ctx()


def test_span_ids_formats_hex():
    trace_id, span_id = span_ids(_Span())
    assert trace_id == "0123456789abcdef0123456789abcdef"
    assert span_id == "0123456789abcdef"


def test_span_ids_none():
    assert span_ids(None) == (None, None)


def test_current_span_ids_no_active_span():
    # No active OTel span (or OpenTelemetry not installed) -> (None, None).
    assert current_span_ids() == (None, None)


class _RecordingClient:
    def __init__(self) -> None:
        self.batches: list[list] = []

    async def ingest(self, evals) -> int:
        batch = list(evals)
        self.batches.append(batch)
        return len(batch)


async def test_scoped_evaluation_batches_and_flushes_once():
    client = _RecordingClient()
    async with EvaluationScope(client, run_id="run-1") as record:  # type: ignore[arg-type]
        record("faithfulness", score=0.9)
        record("toxicity", score=0.0, label="pass")

    assert len(client.batches) == 1
    batch = client.batches[0]
    assert [e.name for e in batch] == ["faithfulness", "toxicity"]
    assert all(e.run_id == "run-1" for e in batch)
