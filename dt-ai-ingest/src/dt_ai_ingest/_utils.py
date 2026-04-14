"""Shared utility functions for dt-ai-ingest adapters."""

from __future__ import annotations

import math
from typing import Any


def safe_float(value: Any) -> float | None:
    """Convert a score value to a Python float, returning None for NaN/inf/non-numeric.

    Evaluation frameworks may return ``numpy.float64``, ``numpy.nan``, plain
    ``None``, or other non-numeric types.  This function normalises all of
    those into either a plain ``float`` or ``None``:

    - Rejects non-numeric types (returns ``None``).
    - Converts ``numpy.float64`` → ``float``.
    - Returns ``None`` for NaN and infinity values.
    """
    if not isinstance(value, (int, float)):
        # numpy numeric types are subclasses of int/float, so they pass the
        # check above.  For anything else, attempt a float() conversion.
        try:
            value = float(value)
        except (TypeError, ValueError):
            return None
    value = float(value)  # numpy.float64 → float
    if math.isnan(value) or math.isinf(value):
        return None
    return value
