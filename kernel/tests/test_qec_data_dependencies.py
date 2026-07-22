"""Contract tests for the optional QEC data-engine dependency bundle."""

from pathlib import Path


KERNEL_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = KERNEL_ROOT.parent


def test_qec_data_dependencies_are_declared() -> None:
    requirements = (KERNEL_ROOT / "requirements.txt").read_text(encoding="utf-8")

    assert "# pyarrow>=18,<26" in requirements
    assert "# duckdb>=1.2,<2" in requirements
    assert "# jsonschema>=4.23,<5" in requirements


def test_qec_data_dependencies_share_one_research_catalog_entry() -> None:
    catalog = (
        REPOSITORY_ROOT / "src-tauri" / "src" / "commands" / "frameworks.rs"
    ).read_text(encoding="utf-8")

    assert 'id: "qec-data"' in catalog
    assert 'label: "QEC Data Engine"' in catalog
    assert 'pip_name: "pyarrow>=18,<26 duckdb>=1.2,<2 jsonschema>=4.23,<5"' in catalog
    assert 'import_name: "pyarrow, duckdb, jsonschema"' in catalog
    assert 'group: "research"' in catalog
