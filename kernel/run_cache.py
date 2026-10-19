"""The loaded-circuit cache (design note section 3.3): one program execution per code version.

Lives inside the preview worker only.  ``parse``, ``transpile``, ``debug_trace``, the Lab's
``trainability_inspect`` / ``trainability_lint`` and every later circuit-loading op share it, so
an edit pause executes the user's program once instead of three to five times.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections import OrderedDict
from dataclasses import dataclass, field
from types import ModuleType
from typing import Any

KEY_VERSION = "rb1"
MAX_ENTRIES = 4
MAX_DEPS = 512

#: A project file the program read: ``(path, mtime_ns, size, kind)``; kind is "file" or "dir".
Dep = tuple[str, int, int, str]
MISSING = (-1, -1)


@dataclass
class LoadedProgram:
    """The outcome of executing one program version (a cache entry when it is deterministic)."""

    key: str
    namespace: dict
    main_module: ModuleType | None = None
    user_modules: dict[str, ModuleType] = field(default_factory=dict)
    line_map: Any = None
    error: dict | None = None  # {"code", "message", "traceback"?, ...extra}
    deps: tuple[Dep, ...] = ()
    exec_ms: float = 0.0
    metrics: dict = field(default_factory=dict)
    cacheable: bool = True


def make_key(
    language: str | None,
    code: str,
    params: dict | None,
    project_root: str | None,
    file_path: str | None,
    executable: str,
) -> str:
    canonical = json.dumps(params or {}, sort_keys=True, default=repr, separators=(",", ":"))
    parts = (KEY_VERSION, language or "", code, canonical, project_root or "", file_path or "", executable)
    return hashlib.sha256("\0".join(parts).encode("utf-8", "surrogatepass")).hexdigest()


def stat_dep(path: str, kind: str) -> Dep:
    try:
        info = os.stat(path)
    except OSError:
        return (path, *MISSING, kind)
    return (path, info.st_mtime_ns, -1 if kind == "dir" else info.st_size, kind)


def deps_valid(deps: tuple[Dep, ...]) -> bool:
    """Every file or directory the program read still looks the way it did."""
    return all(stat_dep(path, kind) == (path, mtime, size, kind) for path, mtime, size, kind in deps)


class ProgramCache:
    """A small LRU of :class:`LoadedProgram` keyed by :func:`make_key`."""

    def __init__(self, max_entries: int = MAX_ENTRIES):
        self._entries: OrderedDict[str, LoadedProgram] = OrderedDict()
        self._max = max_entries

    def get(self, key: str) -> LoadedProgram | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if not deps_valid(entry.deps):
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return entry

    def put(self, entry: LoadedProgram) -> None:
        if not entry.cacheable:
            return
        self._entries[entry.key] = entry
        self._entries.move_to_end(entry.key)
        while len(self._entries) > self._max:
            self._entries.popitem(last=False)

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, key: str) -> bool:
        return key in self._entries
