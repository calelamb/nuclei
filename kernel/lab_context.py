"""Shared plumbing for the PRD 14 Lab packages (trainability, discovery).

Handlers receive a :class:`LabContext` instead of the raw websocket so they
can stream job events from worker threads and register cancellation hooks
that fire when the owning connection closes.
"""

from __future__ import annotations

import asyncio
import itertools
import threading
import weakref
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

SendJson = Callable[[dict], Awaitable[None]]

_owner_lock = threading.Lock()
_owner_hooks: dict[int, dict[str, Callable[[], None]]] = {}
# Owners come from a monotonic counter, never ``id(websocket)``: CPython reuses ids of freed
# objects, so a new connection could inherit (and cancel or see) a dead connection's jobs.
_owner_counter = itertools.count(1)
_owner_by_connection: "weakref.WeakKeyDictionary[Any, int]" = weakref.WeakKeyDictionary()


def owner_for_connection(connection: Any) -> int:
    """The stable, never-reused owner id of ``connection`` (assigned on first use)."""
    with _owner_lock:
        try:
            existing = _owner_by_connection.get(connection)
        except TypeError:
            existing = getattr(connection, "_nuclei_lab_owner", None)
        if existing is not None:
            return existing
        owner = next(_owner_counter)
        try:
            _owner_by_connection[connection] = owner
        except TypeError:
            connection._nuclei_lab_owner = owner
        return owner


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
