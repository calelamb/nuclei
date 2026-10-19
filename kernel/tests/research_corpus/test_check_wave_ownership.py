"""scripts/check-wave-ownership.py: parsing, overlap rules and the CLI contract."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "check-wave-ownership.py"
spec = importlib.util.spec_from_file_location("check_wave_ownership", SCRIPT)
assert spec is not None and spec.loader is not None
cwo = importlib.util.module_from_spec(spec)
sys.modules["check_wave_ownership"] = cwo  # dataclasses resolve annotations through sys.modules
spec.loader.exec_module(cwo)


# -- patterns ---------------------------------------------------------------------


def test_expand_braces_handles_nesting_and_paths() -> None:
    assert cwo.expand_braces("a/{b,c}.py") == ["a/b.py", "a/c.py"]
    assert cwo.expand_braces("a/{b,c/{d,e}}.py") == ["a/b.py", "a/c/d.py", "a/c/e.py"]
    assert cwo.expand_braces("{x/a.py,y/b.csv}") == ["x/a.py", "y/b.csv"]
    assert cwo.expand_braces("plain.py") == ["plain.py"]
    with pytest.raises(cwo.PlanError):
        cwo.expand_braces("a/{b,c.py")


def test_extract_patterns_reads_only_backticked_files() -> None:
    cell = (
        "`kernel/a/{x,y}.py`, `kernel/tests/test_a.py`, `test_b.py`, `CLAUDE.md`, "
        "`playwright.config.ts` (from `old.py`), loader + `scout/`, docs fixtures"
    )
    assert cwo.extract_patterns(cell) == (
        "kernel/a/x.py", "kernel/a/y.py", "kernel/tests/test_a.py", "kernel/tests/test_b.py",
        "CLAUDE.md", "playwright.config.ts",
    )


def test_a_bare_test_name_only_inherits_a_tests_directory() -> None:
    assert cwo.extract_patterns("`src/x.ts`, `test_y.py`") == ("src/x.ts", "test_y.py")


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("kernel/a.py", "kernel/a.py", True),
        ("kernel/a.py", "kernel/b.py", False),
        ("kernel/discovery/**", "kernel/discovery/isolation.py", True),
        ("kernel/discovery/isolation.py", "kernel/discovery/**", True),
        ("kernel/discovery/**", "kernel/trainability/convert.py", False),
        ("kernel/tests/test_x_*.py", "kernel/tests/test_x_core.py", True),
        ("kernel/tests/test_x_*.py", "kernel/tests/test_y_core.py", False),
        ("kernel/tests/test_discovery_*.py", "kernel/tests/test_discovery_goldilocks*.py", True),
        ("kernel/tests/test_a_*.py", "kernel/tests/test_b_*.py", False),
        ("src/components/settings/**", "src/components/settings/settingsRegistry.ts", True),
        ("tests/e2e/real/*.spec.ts", "tests/e2e/real/matrix.spec.ts", True),
        ("tests/e2e/real/*.spec.ts", "tests/e2e/real/sub/matrix.spec.ts", False),
    ],
)
def test_overlap(a: str, b: str, expected: bool) -> None:
    assert cwo.overlap(a, b) is expected
    assert cwo.overlap(b, a) is expected


def test_covers_needs_a_recursive_glob_for_glob_children() -> None:
    assert cwo.covers("a/**", "a/b/c.py") and cwo.covers("a/**", "a/b/**")
    assert not cwo.covers("a/*.py", "a/b/*.py")


# -- a synthetic plan -----------------------------------------------------------------------

MASTER = """\
## 5. Track R

### 5.1 Must-fix units

| Unit | Fixes | Owned files | Acceptance tests |
|---|---|---|---|
| **R-A Adapters** (Wave 0b) | x | `kernel/adapters/**` | t |
| **R-D Corpus** (Wave 0a) | x | `kernel/tests/research_corpus/**`, `scripts/a.sh` | t |

### 5.2 Real-kernel harness — unit **G2** (Wave 1a)

- Owned files: `src/e2e.ts`, `kernel/auth.py`

## 7. Consolidated implementation plan — waves

### Wave 0 — Track R

**Run 0a** (2 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **R-D** Corpus | x | §5.1 |
| **R-C** Env | x | `kernel/requirements.txt` |

**Run 0b** (1 implementer)

| Unit | Scope | Owned files |
|---|---|---|
| **R-A** Adapters | x | §5.1 |

### Wave 1 — Foundations

**Run 1a** (2 implementers)

| Unit | Scope | Owned files |
|---|---|---|
| **F-1** Protocol | x | `kernel/server.py`, `kernel/tests/test_a.py`, `test_b.py` |
| **G2** Harness | x | §5.2 list |

### Wave 6 — Review

| Unit | Scope |
|---|---|
| **REV-P** Physics | x |
"""

SPEC = """\
| Spec unit | Master unit (wave) | Scope | Files (verbatim from master §7) |
|---|---|---|---|
| U1 | **F-1** (Wave 1a) | x | `kernel/server.py`, `kernel/tests/test_a.py` |
| U2 | **R-A** (Wave 0b) | x | `kernel/adapters/qiskit.py` |
| U3 | **REV-P** (Wave 6) | x | per master |
"""


def build(tmp_path: Path, master: str = MASTER, spec: str = SPEC) -> cwo.Report:
    master_path = tmp_path / "master.md"
    master_path.write_text(master, encoding="utf-8")
    spec_path = tmp_path / "01_spec.md"
    spec_path.write_text(spec, encoding="utf-8")
    return cwo.run(master_path, [spec_path], "wave")


def kinds(report: cwo.Report) -> list[str]:
    return [f.kind for f in report.findings]


def test_clean_plan_has_no_findings_and_resolves_pointers(tmp_path: Path) -> None:
    report = build(tmp_path)
    assert report.findings == [], [f.render() for f in report.findings]
    units = cwo.parse_master(MASTER)
    assert units["R-D"].patterns == ("kernel/tests/research_corpus/**", "scripts/a.sh")
    assert units["G2"].patterns == ("src/e2e.ts", "kernel/auth.py")
    assert (units["R-A"].wave, units["R-A"].run) == ("0", "0b")
    assert units["F-1"].patterns[-1] == "kernel/tests/test_b.py"
    assert units["REV-P"].patterns == ()


def test_two_units_of_one_wave_sharing_a_file_fail(tmp_path: Path) -> None:
    master = MASTER.replace("`kernel/requirements.txt`", "`kernel/adapters/qiskit.py`")
    report = build(tmp_path, master)
    assert kinds(report) == ["wave-overlap"]
    assert "R-C" in report.findings[0].message and "R-A" in report.findings[0].message


def test_overlap_across_runs_of_one_wave_is_caught_but_not_across_waves(tmp_path: Path) -> None:
    across_runs = MASTER.replace("`kernel/requirements.txt`", "`kernel/adapters/**`")
    assert "wave-overlap" in kinds(build(tmp_path, across_runs))
    across_waves = tmp_path / "waves.md"
    across_waves.write_text(MASTER.replace("`kernel/server.py`", "`kernel/adapters/x.py`"), encoding="utf-8")
    assert cwo.run(across_waves, [], "wave").findings == []


def test_run_scope_ignores_other_runs_of_the_wave(tmp_path: Path) -> None:
    master_path = tmp_path / "m.md"
    master_path.write_text(MASTER.replace("`kernel/requirements.txt`", "`kernel/adapters/**`"), encoding="utf-8")
    assert cwo.run(master_path, [], "run").findings == []
    assert [f.kind for f in cwo.run(master_path, [], "wave").findings] == ["wave-overlap"]


def test_spec_file_assigned_elsewhere_is_named(tmp_path: Path) -> None:
    spec = SPEC.replace("`kernel/adapters/qiskit.py`", "`kernel/requirements.txt`")
    report = build(tmp_path, spec=spec)
    assert kinds(report) == ["spec-vs-master"]
    assert "assigned to R-C by the master, not R-A" in report.findings[0].message


def test_spec_file_nobody_owns_is_reported(tmp_path: Path) -> None:
    report = build(tmp_path, spec=SPEC.replace("`kernel/adapters/qiskit.py`", "`kernel/brand_new.py`"))
    assert kinds(report) == ["spec-vs-master"]
    assert "not in R-A's master files" in report.findings[0].message


def test_spec_wave_must_match_the_master_run(tmp_path: Path) -> None:
    report = build(tmp_path, spec=SPEC.replace("**R-A** (Wave 0b)", "**R-A** (Wave 0a)"))
    assert kinds(report) == ["spec-wave"]
    # a bare wave number matches any run of that wave
    assert build(tmp_path, spec=SPEC.replace("**F-1** (Wave 1a)", "**F-1** (Wave 1)")).findings == []


def test_spec_unit_unknown_to_the_master(tmp_path: Path) -> None:
    report = build(tmp_path, spec=SPEC.replace("**R-A**", "**R-Z**"))
    assert kinds(report) == ["spec-unit"]


def test_multi_unit_cell_checks_each_unit(tmp_path: Path) -> None:
    spec = SPEC.replace("**F-1** (Wave 1a)", "**F-1 / R-A** (Wave 1a) and **R-D** (Wave 0a)")
    findings = build(tmp_path, spec=spec).findings
    assert [f.kind for f in findings] == ["spec-wave"]  # R-A is Wave 0b, not 1a
    assert "puts R-A in Wave 1a" in findings[0].message


def test_section_5_unit_missing_from_section_7_is_reported(tmp_path: Path) -> None:
    master = MASTER.replace("| **R-A** Adapters | x | §5.1 |\n", "")
    report = build(tmp_path, master)
    assert "master-reference" in kinds(report)


def test_wave_disagreement_between_5_and_7_is_reported(tmp_path: Path) -> None:
    master = MASTER.replace("**R-A Adapters** (Wave 0b)", "**R-A Adapters** (Wave 0a)")
    assert "master-reference" in kinds(build(tmp_path, master))


def test_pointer_to_a_missing_section_5_entry_is_a_parse_error(tmp_path: Path) -> None:
    master = MASTER.replace("| **R-C** Env | x | `kernel/requirements.txt` |", "| **R-Q** Env | x | §5.1 |")
    with pytest.raises(cwo.PlanError, match="R-Q"):
        build(tmp_path, master)


def test_cli_exit_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    master = tmp_path / "master.md"
    spec = tmp_path / "01_spec.md"
    master.write_text(MASTER, encoding="utf-8")
    spec.write_text(SPEC, encoding="utf-8")
    assert cwo.main(["--master", str(master), "--spec", str(spec)]) == 0
    assert "OK" in capsys.readouterr().out
    spec.write_text(SPEC.replace("`kernel/adapters/qiskit.py`", "`kernel/requirements.txt`"), encoding="utf-8")
    assert cwo.main(["--master", str(master), "--spec", str(spec)]) == 1
    assert "FAILED: 1 finding" in capsys.readouterr().out
    master.write_text("# no tables here\n", encoding="utf-8")
    assert cwo.main(["--master", str(master), "--spec", str(spec)]) == 2


def test_json_output(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    import json

    master = tmp_path / "master.md"
    master.write_text(MASTER, encoding="utf-8")
    assert cwo.main(["--master", str(master), "--spec", str(tmp_path / "none.md"), "--json"]) == 2
    master.write_text(MASTER.replace("`kernel/requirements.txt`", "`kernel/adapters/**`"), encoding="utf-8")
    assert cwo.main(["--master", str(master), "--json"]) == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["findings"][0]["kind"] == "wave-overlap"


# -- the real plan ------------------------------------------------------------------------------


def test_the_real_plan_parses_into_the_documented_units() -> None:
    units = cwo.parse_master(cwo.DEFAULT_MASTER.read_text(encoding="utf-8"))
    assert {"R-A", "R-B", "R-C", "R-D", "R-E", "R-F", "R-G", "G2", "F-1", "X", "REV-P"} <= units.keys()
    assert (units["R-D"].wave, units["R-D"].run) == ("0", "0a")
    assert "scripts/check-wave-ownership.py" in units["R-D"].patterns
    assert ".github/workflows/kernel-tests.yml" in units["R-D"].patterns
    assert len(units) >= 36
    for unit in units.values():
        if unit.uid not in ("REV-P", "REV-S", "REV-U", "REL"):
            assert unit.patterns, f"{unit.uid} parsed with no files"
