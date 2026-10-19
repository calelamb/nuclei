"""Make optional packages un-importable, as in the packaged app's managed venv.

``install_blocker()`` puts a finder first on ``sys.meta_path`` that raises
``ModuleNotFoundError`` for the named top-level packages (and their submodules)
and evicts any copy already imported. Used inside a subprocess so the rest of
the test session keeps the real packages.
"""

from __future__ import annotations

import importlib.abc
import sys

#: Not part of kernel/requirements.txt: installed only through the in-app Research catalog.
OPTIONAL_PACKAGES = ("stim", "sinter", "pymatching", "pyarrow", "duckdb", "jsonschema", "fusion_blossom")


class _Blocker(importlib.abc.MetaPathFinder):
    def __init__(self, names: tuple[str, ...]):
        self.names = frozenset(names)

    def find_spec(self, fullname, path=None, target=None):
        if fullname.partition(".")[0] in self.names:
            raise ModuleNotFoundError(f"No module named {fullname!r} (blocked for the test)", name=fullname)
        return None


def install_blocker(names: tuple[str, ...] = OPTIONAL_PACKAGES) -> None:
    for loaded in [m for m in sys.modules if m.partition(".")[0] in names]:
        del sys.modules[loaded]
    sys.meta_path.insert(0, _Blocker(tuple(names)))
