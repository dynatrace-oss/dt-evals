"""Adapters converting third-party eval results into ``Eval`` rows."""

from __future__ import annotations

from dt_ai_ingest.integrations.deepeval import from_deepeval
from dt_ai_ingest.integrations.ragas import from_ragas

__all__ = ["from_deepeval", "from_ragas"]
