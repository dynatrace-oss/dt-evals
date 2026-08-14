from __future__ import annotations

import math
from typing import Any, Protocol

from dt_ai_ingest.schema import Eval

_EVAL_FIELDS = set(Eval.model_fields) - {"extra"}


class ConvertAdapter(Protocol):
    """Static contract for convert-style adapters; enforced by mypy + tests."""

    def __call__(
        self,
        result: Any,
        *,
        run_id: str | None = None,
        mapping: dict[str, str] | None = None,
        defaults: dict[str, Any] | None = None,
    ) -> list[Eval]: ...


def require(package: str, extra: str | None = None) -> None:
    try:
        __import__(package)
    except ImportError:
        raise ImportError(
            f"`{package}` is required. Install with: pip install dt-ai-ingest[{extra or package}]"
        ) from None


def nan_to_none(v: Any) -> Any:
    try:
        return None if math.isnan(v) else v
    except TypeError:
        return v


def build_eval_kwargs(
    row: dict[str, Any],
    mapping: dict[str, str] | None,
    defaults: dict[str, Any] | None,
) -> dict[str, Any]:
    rename = mapping or {}
    renamed = {rename.get(k, k): v for k, v in row.items() if v is not None}
    known = {k: v for k, v in renamed.items() if k in _EVAL_FIELDS}
    extra = {k: v for k, v in renamed.items() if k not in _EVAL_FIELDS}
    merged: dict[str, Any] = {**(defaults or {}), **known}
    if extra:
        merged["extra"] = {**merged.get("extra", {}), **extra}
    return merged
