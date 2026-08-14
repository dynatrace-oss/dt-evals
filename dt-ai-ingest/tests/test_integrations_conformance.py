"""Every from_* adapter under integrations/ must match the ConvertAdapter shape."""

from __future__ import annotations

import importlib
import inspect
import pkgutil

import pytest

import dt_ai_ingest.integrations as integrations_pkg

_KEYWORD_ONLY = inspect.Parameter.KEYWORD_ONLY


def _adapter_functions() -> list[tuple[str, object]]:
    found: list[tuple[str, object]] = []
    for modinfo in pkgutil.iter_modules(integrations_pkg.__path__):
        if modinfo.name.startswith("_"):
            continue
        mod = importlib.import_module(f"dt_ai_ingest.integrations.{modinfo.name}")
        for name, obj in vars(mod).items():
            if (
                name.startswith("from_")
                and inspect.isfunction(obj)
                and obj.__module__ == mod.__name__
            ):
                found.append((f"{modinfo.name}.{name}", obj))
    return found


_ADAPTERS = _adapter_functions()


def test_at_least_one_adapter_is_discovered():
    assert _ADAPTERS, "no from_* adapters found under dt_ai_ingest.integrations"


@pytest.mark.parametrize("label,func", _ADAPTERS, ids=[label for label, _ in _ADAPTERS])
def test_adapter_matches_convert_contract(label, func):
    params = inspect.signature(func).parameters
    assert "result" in params, f"{label}: missing positional 'result'"
    for kw in ("run_id", "mapping", "defaults"):
        assert kw in params, f"{label}: missing keyword-only '{kw}'"
        assert params[kw].kind is _KEYWORD_ONLY, f"{label}: '{kw}' must be keyword-only"
        assert params[kw].default is None, f"{label}: '{kw}' must default to None"
