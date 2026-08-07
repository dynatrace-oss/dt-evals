"""Environment-variable helpers."""

from __future__ import annotations

import os


def first_env(*names: str) -> str:
    """Return the first non-empty environment variable among *names*, else ``""``."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""
