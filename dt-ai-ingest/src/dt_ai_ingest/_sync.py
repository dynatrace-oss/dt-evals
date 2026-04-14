"""Sync/async bridge — run coroutines from synchronous code safely."""

from __future__ import annotations

import asyncio
import threading
from typing import Any, TypeVar

T = TypeVar("T")


def run_sync(coro: Any) -> T:  # type: ignore[type-var]
    """Execute *coro* and return its result, even inside a running event loop.

    - If no event loop is running: use ``asyncio.run()``.
    - If an event loop is running (Jupyter, async frameworks): spawn a
      background thread with its own loop so we never nest ``run()``.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # No running loop — simplest path.
        return asyncio.run(coro)  # type: ignore[no-any-return]

    # Running loop detected (Jupyter, etc.) — run in a background thread.
    result: Any = RuntimeError("coroutine did not complete")

    def _thread_target() -> None:
        nonlocal result
        try:
            result = asyncio.run(coro)
        except BaseException as exc:
            result = exc

    thread = threading.Thread(target=_thread_target, daemon=True)
    thread.start()
    thread.join()

    if isinstance(result, Exception):
        raise result
    if isinstance(result, BaseException):
        # Re-raise true BaseException types (KeyboardInterrupt, SystemExit, etc.)
        # on the calling thread without chaining, preserving pass-through semantics.
        raise result from None
    return result  # type: ignore[return-value]
