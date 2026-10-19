"""The conftest optional-dependency table must stay in step with the tree."""

from __future__ import annotations

import ast
from pathlib import Path

from kernel.tests import conftest

TESTS_DIR = Path(__file__).parent


def test_every_guard_names_an_existing_test_module():
    for guard in conftest.OPTIONAL_DEPENDENCY_GUARDS:
        assert (TESTS_DIR / guard.module).is_file(), (
            f"{guard.module} was renamed or removed; update OPTIONAL_DEPENDENCY_GUARDS"
        )


def _test_function_names(module: str) -> set[str]:
    tree = ast.parse((TESTS_DIR / module).read_text())
    return {
        node.name for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_")
    }


def test_every_guard_selects_tests_that_exist():
    """A renamed test would silently fall out of its guard and fail on the minimal venv."""
    for guard in conftest.OPTIONAL_DEPENDENCY_GUARDS:
        assert guard.test_names or guard.name_prefix, (
            f"{guard.module}: a guard must name its tests or a prefix, never the whole module"
        )
        defined = _test_function_names(guard.module)
        missing = [name for name in guard.test_names if name not in defined]
        assert not missing, f"{guard.module}: guard names tests that no longer exist: {missing}"
        if guard.name_prefix:
            assert any(name.startswith(guard.name_prefix) for name in defined), (
                f"{guard.module}: no test starts with {guard.name_prefix!r}"
            )


def test_qdk_free_tests_are_not_guarded():
    """Detect-pattern, plain-Python routing and Qiskit-only Bloch tests run on the minimal venv."""
    guarded = {
        (g.module, name) for g in conftest.OPTIONAL_DEPENDENCY_GUARDS for name in g.test_names
    }
    for unguarded in (
        ("test_qsharp_adapter.py", "test_qsharp_detect_pattern_ignores_python_starter_templates"),
        ("test_qsharp_adapter.py", "test_plain_python_still_unsupported_framework"),
        ("test_qsharp_adapter.py", "test_executor_language_python_skips_qsharp_adapter"),
        ("test_adapter_bloch_order.py", "test_qiskit_bloch_coords_follow_display_qubit_order"),
        ("test_adapter_bloch_order.py", "test_qiskit_bloch_x_axis_lands_on_the_hadamard_qubit"),
    ):
        assert unguarded not in guarded
        assert unguarded[1] in _test_function_names(unguarded[0])


def test_missing_reports_only_absent_packages():
    assert conftest._missing(("json", "os")) == []
    assert conftest._missing(("json", "nuclei_definitely_not_installed")) == [
        "nuclei_definitely_not_installed"
    ]


def test_minimal_venv_modules_guard_themselves_with_importorskip():
    """The 11 Research-catalog test modules skip (not error) without their packages."""
    guarded = [
        "qec_data/test_catalog.py", "qec_data/test_engine_import_mapping.py",
        "qec_data/test_queries.py", "qec_data/test_server.py",
        "qec_data/test_server_review.py", "qec_data/test_storage.py",
        "qec_data/test_storage_durability.py", "qec_data/test_storage_record_kinds.py",
        "qec_data/test_tabular_adapter.py", "test_qec_data_schemas.py",
        "test_qec_import_chunk_schemas.py",
    ]
    for relative in guarded:
        assert "pytest.importorskip(" in (TESTS_DIR / relative).read_text(), relative
