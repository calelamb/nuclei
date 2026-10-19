"""The conftest optional-dependency table must stay in step with the tree."""

from __future__ import annotations

from pathlib import Path

from kernel.tests import conftest

TESTS_DIR = Path(__file__).parent


def test_every_guard_names_an_existing_test_module():
    for guard in conftest.OPTIONAL_DEPENDENCY_GUARDS:
        assert (TESTS_DIR / guard.module).is_file(), (
            f"{guard.module} was renamed or removed; update OPTIONAL_DEPENDENCY_GUARDS"
        )


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
