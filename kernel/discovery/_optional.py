"""Optional-dependency helpers for the Discovery Engine.

The managed runtime venv ships numpy / qiskit / cirq only. Stim, PyMatching,
Sinter and the QEC data stack are optional Research-catalog installs, so no
Discovery module may import them at module import time on a path that the
non-QEC evaluators share. Two tools live here:

* :func:`lazy_module` returns a proxy that imports the real module on first
  attribute access, so ``stim.Circuit`` keeps working inside function bodies
  while ``import`` of the host module never fails.
* :func:`missing_modules` / :func:`install_hint` answer "is this evaluator
  runnable here?" without importing anything heavy.

``missing_dependency`` messages name the Research catalog entry ids from
``src-tauri/src/commands/frameworks.rs``.
"""

from __future__ import annotations

import importlib
import importlib.util
from types import ModuleType
from typing import Any, Iterable

#: import name -> Research catalog entry id (frameworks.rs)
CATALOG_IDS: dict[str, str] = {
    "stim": "stim",
    "sinter": "sinter",
    "pymatching": "pymatching",
    "pyarrow": "qec-data",
    "duckdb": "qec-data",
    "jsonschema": "qec-data",
}
#: catalog id -> label shown in the app
CATALOG_LABELS: dict[str, str] = {
    "stim": "Stim",
    "sinter": "Sinter",
    "pymatching": "PyMatching",
    "qec-data": "QEC Data Engine",
}


class MissingDependency(ImportError):
    """An optional package is absent; ``missing`` lists its import names."""

    def __init__(self, missing: Iterable[str]):
        self.missing = list(dict.fromkeys(missing))
        super().__init__(missing_message(self.missing))


def is_importable(name: str) -> bool:
    """True when ``name`` can be found, without importing it (blocked imports count as absent)."""
    importlib.invalidate_caches()  # a package pip-installed since startup must be seen without a restart
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, AttributeError):
        return False


def missing_modules(requires: Iterable[str]) -> list[str]:
    return [name for name in requires if not is_importable(name)]


def catalog_ids(missing: Iterable[str]) -> list[str]:
    """Distinct Research catalog entry ids that provide ``missing`` (order preserved)."""
    return list(dict.fromkeys(CATALOG_IDS.get(name, name) for name in missing))


def _human_list(items: list[str]) -> str:
    quoted = [f"'{item}'" for item in items]
    if len(quoted) <= 2:
        return " and ".join(quoted)
    return ", ".join(quoted[:-1]) + f", and {quoted[-1]}"


def install_hint(missing: Iterable[str]) -> dict[str, Any]:
    """``{"catalog_ids": [...], "hint": str}`` for the wire's ``install`` field."""
    ids = catalog_ids(missing)
    labels = [CATALOG_LABELS.get(i, i) for i in ids]
    noun = "entry" if len(ids) == 1 else "entries"
    return {
        "catalog_ids": ids,
        "hint": f"Install {_human_list(labels)} from the Research catalog ({noun}: {', '.join(ids)}) in Environment setup.",
    }


def missing_message(missing: Iterable[str]) -> str:
    names = list(missing)
    return (
        f"This needs {_human_list(names)}, which {'is' if len(names) == 1 else 'are'} not installed. "
        f"{install_hint(names)['hint']}"
    )


class _LazyModule(ModuleType):
    """Imports the target on first attribute access; absence raises :class:`MissingDependency`."""

    def __init__(self, name: str):
        super().__init__(f"lazy:{name}")
        object.__setattr__(self, "_target_name", name)
        object.__setattr__(self, "_target", None)

    def _load(self) -> ModuleType:
        target = object.__getattribute__(self, "_target")
        if target is None:
            name = object.__getattribute__(self, "_target_name")
            try:
                target = importlib.import_module(name)
            except ImportError as exc:
                raise MissingDependency([name]) from exc
            object.__setattr__(self, "_target", target)
        return target

    def __getattr__(self, attr: str) -> Any:
        return getattr(self._load(), attr)


def lazy_module(name: str) -> ModuleType:
    """A proxy for ``import name`` that defers the import (and its ImportError) to first use."""
    return _LazyModule(name)
