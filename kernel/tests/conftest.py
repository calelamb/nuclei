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
    """Skip the named tests in ``module`` when ``requires`` is absent.

    A test is selected by exact function name (``test_names``) or by ``name_prefix``; a guard
    must give at least one of them, so a module never skips wholesale. Tests that pass on the
    minimal venv (detect-pattern, plain-Python routing, Qiskit-only checks) stay unguarded.
    """

    module: str
    requires: tuple[str, ...]
    name_prefix: str = ""
    test_names: tuple[str, ...] = ()

    def selects(self, function_name: str) -> bool:
        if function_name in self.test_names:
            return True
        return bool(self.name_prefix) and function_name.startswith(self.name_prefix)


OPTIONAL_DEPENDENCY_GUARDS: tuple[OptionalDependencyGuard, ...] = (
    OptionalDependencyGuard(
        "test_qsharp_adapter.py", ("qdk",),
        test_names=(
            "test_disposable_worker_runs_qdk_operation_and_exit_cleanup_on_calling_thread",
            "test_parse_source_bell_builds_snapshot",
            "test_parse_source_syntax_error_yields_compile_error",
            "test_parse_source_no_runnable_operation_is_quiet",
            "test_entry_resolution_prefers_main",
            "test_entry_resolution_last_zero_param_op_wins_without_main",
            "test_execute_source_without_runnable_operation_returns_no_circuit",
            "test_execute_source_bell_with_dump_returns_exact_state",
            "test_execute_source_without_dump_falls_back_to_sampled_bloch",
            "test_concurrent_parse_and_execute_do_not_corrupt_sessions",
            "test_wedge_clears_when_runaway_finishes",
            "test_compile_qir_timeout_raises_runtime_error",
            "test_mresetz_maps_to_measure_then_reset",
            "test_compile_qir_base_profile_returns_qir",
            "test_compile_qir_adaptive_ri_profile_returns_qir",
            "test_compile_qir_unknown_profile_raises_value_error",
            "test_executor_parse_with_qsharp_language_routes_to_adapter",
            "test_executor_execute_with_qsharp_language_returns_result_and_snapshot",
            "test_executor_parse_detects_qsharp_without_language_hint",
        ),
    ),
    OptionalDependencyGuard(
        "test_adapter_bloch_order.py", ("qdk",),
        test_names=("test_qsharp_and_qiskit_agree_on_bloch_qubit_order",),
    ),
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
            function_name = getattr(item, "originalname", None) or item.name
            if module != guard.module or not guard.selects(function_name):
                continue
            missing = _missing(guard.requires)
            if missing:
                item.add_marker(pytest.mark.skip(
                    reason=f"optional package(s) not installed: {', '.join(missing)}",
                ))
