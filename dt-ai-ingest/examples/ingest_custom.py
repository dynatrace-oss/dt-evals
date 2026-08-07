"""Minimal custom-eval ingestion — the Pattern C on-ramp.

Run (dry-run prints payloads, no network):

    python examples/ingest_custom.py

Set DT_ENDPOINT + DT_API_TOKEN and flip dry_run=False to actually send.
"""

from __future__ import annotations

import asyncio
import json
import logging

from dt_ai_ingest import DynatraceClient, Eval


def is_valid_json(text: str) -> float:
    try:
        json.loads(text)
        return 1.0
    except ValueError:
        return 0.0


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")  # show dry-run payloads

    async with DynatraceClient(dry_run=True) as client:  # reads DT_ENDPOINT / DT_API_TOKEN
        await client.submit(
            "valid_json",
            score=is_valid_json('{"ok": true}'),
            provider="my-regex-scorer",
        )
        await client.ingest(
            [
                Eval(name="faithfulness", score=0.92, label="pass", explanation="grounded"),
                {"name": "toxicity", "score": 0.0, "label": "pass"},
            ]
        )


if __name__ == "__main__":
    asyncio.run(main())
