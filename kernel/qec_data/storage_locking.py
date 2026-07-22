"""Process-local locking for QEC storage sessions."""

from __future__ import annotations

import threading
import weakref


_LOCKS_GUARD = threading.Lock()
_SESSION_LOCKS: weakref.WeakValueDictionary[str, threading.RLock] = (
    weakref.WeakValueDictionary()
)


def session_lock(path: str) -> threading.RLock:
    with _LOCKS_GUARD:
        lock = _SESSION_LOCKS.get(path)
        if lock is None:
            lock = threading.RLock()
            _SESSION_LOCKS[path] = lock
        return lock
