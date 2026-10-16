"""Fixtures for the nuclei_mcp suite. Adds kernel/ to sys.path so the
standalone ``nuclei_mcp`` package imports the same way ``python -m nuclei_mcp``
(run from kernel/) does."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

KERNEL_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = KERNEL_DIR.parent
if str(KERNEL_DIR) not in sys.path:
    sys.path.insert(0, str(KERNEL_DIR))

from nuclei_mcp.ceilings import Ceilings  # noqa: E402
from nuclei_mcp.context import Context  # noqa: E402
from nuclei_mcp.journal import Journal  # noqa: E402

FIXTURE_CSV = REPO_ROOT / "src" / "components" / "qec" / "__fixtures__" / "campaign_stats.csv"


@pytest.fixture
def ctx(tmp_path: Path) -> Context:
    return Context(journal=Journal(tmp_path / "journal"), ceilings=Ceilings())


@pytest.fixture
def fixture_csv() -> Path:
    assert FIXTURE_CSV.is_file()
    return FIXTURE_CSV


def make_row(d: int, p: float, shots: int, errors: int, *, discards: int = 0, decoder: str = "pymatching", rounds: int | None = None) -> dict:
    meta = {"d": d, "p": p, "decoder": decoder, "rounds": rounds if rounds is not None else d}
    return {"shots": shots, "errors": errors, "discards": discards, "seconds": 0.0,
            "decoder": decoder, "strong_id": f"{d}-{p}-{decoder}-{shots}-{errors}",
            "json_metadata": meta, "custom_counts": {}}
