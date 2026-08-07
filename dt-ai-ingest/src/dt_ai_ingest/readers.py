"""File readers: stream rows from ``.csv`` / ``.jsonl`` / ``.json`` / ``.parquet`` into ``Eval``s.

``mapping`` renames columns onto ``Eval`` field names, ``defaults`` fills fields
the file omits, and any leftover columns land in ``Eval.extra``. Values are
coerced by Pydantic (e.g. a CSV ``"0.87"`` -> ``float``).
"""

from __future__ import annotations

import csv
import json
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

from dt_ai_ingest.schema import Eval

# Known Eval field names (everything else in a row is routed into `extra`).
_FIELDS = set(Eval.model_fields) - {"extra"}


def _read_parquet(path: Path) -> Iterator[dict[str, Any]]:
    try:
        import pyarrow.parquet as pq
    except ImportError:
        raise ImportError(
            "pyarrow is required to read Parquet files: pip install dt-ai-ingest[parquet]"
        ) from None
    for batch in pq.ParquetFile(path).iter_batches():
        # to_pydict() gives col->list; zip into row dicts and drop None values.
        columns = batch.to_pydict()
        keys = list(columns)
        for values in zip(*[columns[k] for k in keys]):
            yield {k: v for k, v in zip(keys, values) if v is not None}


def read_rows(path: Path) -> Iterator[dict[str, Any]]:
    """Yield raw row dicts from a supported file (streamed for jsonl/csv/parquet)."""
    suffix = path.suffix.lower()
    if suffix == ".jsonl":
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)
    elif suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError(f"{path}: expected a top-level JSON array")
        yield from data
    elif suffix == ".csv":
        with path.open(encoding="utf-8", newline="") as handle:
            yield from csv.DictReader(handle)
    elif suffix == ".parquet":
        yield from _read_parquet(path)
    else:
        raise ValueError(f"unsupported file type {path.suffix!r} (use .csv/.jsonl/.json/.parquet)")


def rows_to_evals(
    path: str | Path,
    mapping: Mapping[str, str] | None = None,
    defaults: Mapping[str, Any] | None = None,
) -> Iterator[Eval]:
    """Read *path* and yield validated ``Eval``s."""
    rename = dict(mapping or {})
    fill = dict(defaults or {})
    for row in read_rows(Path(path)):
        renamed = {rename.get(key, key): value for key, value in row.items()}
        # Blank CSV cells are treated as absent rather than empty strings.
        known = {k: v for k, v in renamed.items() if k in _FIELDS and v != ""}
        extra = {k: v for k, v in renamed.items() if k not in _FIELDS}
        merged: dict[str, Any] = {**fill, **known}
        if extra:
            merged["extra"] = {**merged.get("extra", {}), **extra}
        yield Eval(**merged)
