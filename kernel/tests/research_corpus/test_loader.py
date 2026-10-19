"""The glob loader: units are discovered, never registered by hand."""

from __future__ import annotations

from pathlib import Path

import pytest

from kernel.tests.research_corpus._support import require_yaml

require_yaml()

from kernel.tests.research_corpus import loader  # noqa: E402


def write_unit(root: Path, unit: str, expected: str, programs: dict[str, str] | None = None) -> Path:
    directory = root / unit
    (directory / "programs").mkdir(parents=True)
    (directory / "expected.yaml").write_text(expected, encoding="utf-8")
    for name, source in (programs or {}).items():
        target = directory / "programs" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source, encoding="utf-8")
    return directory


BASIC = "schema: 1\nprograms:\n  a-one: {parse: ok, execute: ok}\n"


def test_units_are_discovered_by_glob_without_registration(tmp_path: Path) -> None:
    write_unit(tmp_path, "zeta", BASIC.replace("a-one", "z-one"), {"z-one.py": "x = 1\n"})
    write_unit(tmp_path, "alpha", BASIC, {"a-one.py": "x = 1\n"})
    (tmp_path / "not_a_unit").mkdir()
    (tmp_path / "not_a_unit" / "notes.txt").write_text("ignored")
    assert [u.name for u in loader.discover_units(tmp_path)] == ["alpha", "zeta"]
    assert [(c.unit, c.id) for c in loader.load_cases("full", tmp_path)] == [("alpha", "a-one"), ("zeta", "z-one")]


def test_language_comes_from_the_file_extension(tmp_path: Path) -> None:
    expected = "schema: 1\nprograms:\n  p: {execute: ok}\n  q: {execute: ok}\n  s: {execute: ok}\n"
    write_unit(tmp_path, "u", expected, {"p.py": "pass\n", "q.qs": "operation Main() : Unit {}\n", "s.stim": "H 0\n"})
    languages = {c.id: c.language for c in loader.load_cases("min", tmp_path)}
    assert languages == {"p": "python", "q": "qsharp", "s": "stim"}


def test_env_overrides_merge_and_null_removes_a_key(tmp_path: Path) -> None:
    expected = (
        "schema: 1\nprograms:\n"
        "  p:\n    execute: ok\n    max_seconds: 5\n    options: {seed: 1, timeout: 20}\n"
        "    envs:\n      qk2: {execute: 'error:execution_error', max_seconds: null, options: {seed: 2}}\n"
    )
    write_unit(tmp_path, "u", expected, {"p.py": "pass\n"})
    full = loader.load_cases("full", tmp_path)[0]
    qk2 = loader.load_cases("qk2", tmp_path)[0]
    assert (full.execute, full.max_seconds, full.options) == ("ok", 5, {"seed": 1, "timeout": 20})
    assert (qk2.execute, qk2.max_seconds, qk2.options) == ("error:execution_error", None, {"seed": 2, "timeout": 20})


def test_xfail_accepts_one_or_several_audit_ids(tmp_path: Path) -> None:
    expected = (
        "schema: 1\nprograms:\n"
        "  one: {execute: ok, xfail: {id: R-1, reason: why, current: {execute: 'error:x'}}}\n"
        "  two: {execute: ok, xfail: {id: [R-3, R-2], reason: why}}\n"
    )
    write_unit(tmp_path, "u", expected, {"one.py": "pass\n", "two.py": "pass\n"})
    cases = {c.id: c for c in loader.load_cases("min", tmp_path)}
    assert cases["one"].xfail.rids == ("R-1",) and cases["one"].xfail.current == {"execute": "error:x"}
    assert cases["two"].xfail.label == "R-3+R-2"
    ledger = loader.xfail_ledger(tmp_path)
    assert ledger == {"R-1": {e: ["one"] for e in loader.ENVS}, "R-3": {e: ["two"] for e in loader.ENVS}, "R-2": {e: ["two"] for e in loader.ENVS}}


def test_later_unit_flips_a_scout_expectation_with_overrides(tmp_path: Path) -> None:
    base = "schema: 1\nprograms:\n  bug: {execute: ok, xfail: {id: R-1, reason: why}}\n"
    write_unit(tmp_path, "scout", base, {"bug.py": "pass\n"})
    fixer = tmp_path / "r_a"
    fixer.mkdir()
    (fixer / "overrides.yaml").write_text("bug: {xfail: null, note: fixed by R-A}\n")
    case = loader.load_cases("full", tmp_path)[0]
    assert (case.unit, case.xfail, case.note) == ("scout", None, "fixed by R-A")
    assert loader.xfail_ledger(tmp_path) == {}


def test_override_of_unknown_program_is_an_error(tmp_path: Path) -> None:
    write_unit(tmp_path, "scout", BASIC, {"a-one.py": "pass\n"})
    (tmp_path / "r_b").mkdir()
    (tmp_path / "r_b" / "overrides.yaml").write_text("ghost: {execute: ok}\n")
    with pytest.raises(loader.LoaderError, match="unknown program id 'ghost'"):
        loader.load_cases("full", tmp_path)


def test_duplicate_ids_across_units_are_rejected(tmp_path: Path) -> None:
    write_unit(tmp_path, "one", BASIC, {"a-one.py": "pass\n"})
    write_unit(tmp_path, "two", BASIC, {"a-one.py": "pass\n"})
    with pytest.raises(loader.LoaderError, match="duplicate program id 'a-one'"):
        loader.load_cases("full", tmp_path)


def test_program_without_a_file_or_with_two_is_rejected(tmp_path: Path) -> None:
    write_unit(tmp_path, "u", BASIC)
    with pytest.raises(loader.LoaderError, match="exactly one file for program 'a-one', found 0"):
        loader.load_cases("full", tmp_path)
    (tmp_path / "u" / "programs" / "a-one.py").write_text("pass\n")
    (tmp_path / "u" / "programs" / "a-one.qs").write_text("pass\n")
    with pytest.raises(loader.LoaderError, match="found 2"):
        loader.load_cases("full", tmp_path)


def test_project_program_is_a_directory_with_a_main(tmp_path: Path) -> None:
    write_unit(tmp_path, "u", BASIC, {"a-one/main.py": "import helper\n", "a-one/helper.py": "x = 1\n"})
    case = loader.load_cases("full", tmp_path)[0]
    assert case.code == "import helper\n"
    assert case.project_dir == tmp_path / "u" / "programs" / "a-one"


def test_unknown_env_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(loader.LoaderError, match="unknown corpus env 'macos'"):
        loader.load_cases("macos", tmp_path)


@pytest.mark.parametrize(
    ("entry", "complaint"),
    [
        ("{execute: fine}", "invalid status 'fine'"),
        ("{execute: ok, xfail: {id: R-99, reason: x}}", "is not an audit id"),
        ("{execute: ok, xfail: {id: R-1, reason: x, why: y}}", "unknown key 'why'"),
        ("{execute: ok, speed: fast}", "unknown key 'speed'"),
        ("{execute: ok, options: {warp: 9}}", "unknown key 'warp'"),
        ("{execute: ok, options: {phases: [lint]}}", "unknown phase 'lint'"),
        ("{execute: ok, envs: {windows: {execute: ok}}}", "unknown env 'windows'"),
        ("{note: nothing is asserted}", "no expected status for any driven phase"),
    ],
)
def test_validate_reports_typos_instead_of_ignoring_them(tmp_path: Path, entry: str, complaint: str) -> None:
    write_unit(tmp_path, "u", f"schema: 1\nprograms:\n  p: {entry}\n", {"p.py": "pass\n"})
    assert any(complaint in problem for problem in loader.validate(tmp_path))


def test_validate_is_clean_for_a_good_corpus(tmp_path: Path) -> None:
    write_unit(tmp_path, "u", BASIC, {"a-one.py": "pass\n"})
    assert loader.validate(tmp_path) == []


def test_wrong_schema_version_is_rejected(tmp_path: Path) -> None:
    write_unit(tmp_path, "u", "schema: 2\nprograms: {}\n")
    with pytest.raises(loader.LoaderError, match="schema: 1"):
        loader.load_cases("full", tmp_path)


def test_deep_merge_never_mutates_its_inputs() -> None:
    base = {"a": {"b": 1, "c": [1, 2]}, "d": 4}
    patch = {"a": {"b": 2}, "d": None}
    merged = loader.deep_merge(base, patch)
    assert merged == {"a": {"b": 2, "c": [1, 2]}}
    assert base == {"a": {"b": 1, "c": [1, 2]}, "d": 4} and patch == {"a": {"b": 2}, "d": None}
    merged["a"]["c"].append(3)
    assert base["a"]["c"] == [1, 2]
