"""Shared plumbing for the PRD 14 Lab packages (trainability, discovery).

Handlers receive a :class:`LabContext` instead of the raw websocket so they
can stream job events from worker threads and register cancellation hooks
that fire when the owning connection closes.
"""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

SendJson = Callable[[dict], Awaitable[None]]

_owner_lock = threading.Lock()
_owner_hooks: dict[int, dict[str, Callable[[], None]]] = {}


@dataclass
class LabContext:
    executor: Any
    send_json: SendJson
    loop: asyncio.AbstractEventLoop
    owner: int

    def emit_threadsafe(self, payload: dict) -> None:
        """Send ``payload`` from a worker thread; never raises."""
        coro = self.send_json(payload)
        try:
            asyncio.run_coroutine_threadsafe(coro, self.loop)
        except RuntimeError:
            # Event loop already closed (kernel shutting down).
            coro.close()

    def on_release(self, key: str, hook: Callable[[], None]) -> None:
        """Run ``hook`` when this connection closes (idempotent per key)."""
        with _owner_lock:
            _owner_hooks.setdefault(self.owner, {})[key] = hook

    def forget(self, key: str) -> None:
        with _owner_lock:
            hooks = _owner_hooks.get(self.owner)
            if hooks is not None:
                hooks.pop(key, None)
                if not hooks:
                    _owner_hooks.pop(self.owner, None)


def release_owner(owner: int) -> None:
    with _owner_lock:
        hooks = _owner_hooks.pop(owner, {})
    for hook in hooks.values():
        try:
            hook()
        except Exception:
            pass
