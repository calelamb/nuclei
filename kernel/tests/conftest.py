"""Repo-wide collection guard for the kernel test suite.

macOS Finder (and some sync tools) drop duplicate copies named
"<name> 2.py" next to the originals. Those stale snapshots assert
*old* behavior, so collecting them makes the suite double-count tests
at best and fail against current code at worst. Ignore them at
collection time; the files themselves are gitignored (`* 2.py`) and
local-only.

Optional-dependency policy (PRD 15 R-21): the whole suite must run -- skipping,
never erroring or failing -- on a minimal venv built from
``kernel/requirements.txt`` alone, because that is what the packaged app ships.
Test modules that need a Research-catalog package guard themselves with
``pytest.importorskip``; the table below covers tests that must not be edited
in place (the Q# tests need ``qdk``, which is deliberately absent from
``kernel/requirements.txt``). CI's full job installs every package, so nothing
is skipped there.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass

import pytest

collect_ignore_glob = ["* 2.py"]


@dataclass(frozen=True)
class OptionalDependencyGuard:
    """Skip tests in ``module`` (whose names start with ``name_prefix``) when ``requires`` is absent."""

    module: str
    requires: tuple[str, ...]
    name_prefix: str = ""


OPTIONAL_DEPENDENCY_GUARDS: tuple[OptionalDependencyGuard, ...] = (
    OptionalDependencyGuard("test_qsharp_adapter.py", ("qdk",)),
    OptionalDependencyGuard("test_adapter_bloch_order.py", ("qdk",)),
    OptionalDependencyGuard("test_experiment_execution.py", ("qdk",), name_prefix="test_qsharp_"),
)


def _missing(requires: tuple[str, ...]) -> list[str]:
    return [name for name in requires if importlib.util.find_spec(name) is None]


def pytest_configure(config) -> None:
    # PRD 14 marks multi-second physics and sandbox tests; they still run by default.
    config.addinivalue_line("markers", "slow: takes more than ~10 s on an idle machine")


def pytest_collection_modifyitems(config, items) -> None:
    for item in items:
        module = item.path.name
        for guard in OPTIONAL_DEPENDENCY_GUARDS:
            if module != guard.module or not item.name.startswith(guard.name_prefix):
                continue
            missing = _missing(guard.requires)
            if missing:
                item.add_marker(pytest.mark.skip(
                    reason=f"optional package(s) not installed: {', '.join(missing)}",
                ))
