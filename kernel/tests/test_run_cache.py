"""The loaded-circuit cache: keys, LRU, dependency validation (the worker-level behaviour is in test_run_worker)."""

from __future__ import annotations

import os
import time

from kernel import run_cache
from kernel.run_cache import LoadedProgram, ProgramCache, make_key


def program(key: str, deps=(), cacheable: bool = True) -> LoadedProgram:
    return LoadedProgram(key=key, namespace={}, deps=tuple(deps), cacheable=cacheable)


def test_key_depends_on_everything_that_changes_the_program() -> None:
    base = make_key("python", "x = 1", {"a": 1}, "/proj", "/proj/main.py", "/usr/bin/python")
    assert base == make_key("python", "x = 1", {"a": 1}, "/proj", "/proj/main.py", "/usr/bin/python")
    variants = [
        make_key("python", "x = 2", {"a": 1}, "/proj", "/proj/main.py", "/usr/bin/python"),
        make_key("python", "x = 1", {"a": 2}, "/proj", "/proj/main.py", "/usr/bin/python"),
        make_key("python", "x = 1", {"a": 1}, "/other", "/proj/main.py", "/usr/bin/python"),
        make_key("python", "x = 1", {"a": 1}, "/proj", "/proj/other.py", "/usr/bin/python"),
        make_key("python", "x = 1", {"a": 1}, "/proj", "/proj/main.py", "/venv/bin/python"),
    ]
    assert len({base, *variants}) == 6


def test_param_order_and_language_default_do_not_change_the_key() -> None:
    assert make_key("python", "c", {"a": 1, "b": 2}, None, None, "py") == make_key(None, "c", {"b": 2, "a": 1}, None, None, "py")


def test_lru_keeps_the_four_most_recent() -> None:
    cache = ProgramCache()
    for index in range(6):
        cache.put(program(f"k{index}"))
    assert len(cache) == 4 and "k0" not in cache and "k1" not in cache and "k5" in cache
    cache.get("k2")
    cache.put(program("k6"))
    assert "k2" in cache and "k3" not in cache


def test_uncacheable_entries_are_not_stored() -> None:
    cache = ProgramCache()
    cache.put(program("bad", cacheable=False))
    assert cache.get("bad") is None and len(cache) == 0


def test_invalidates_on_data_file_change(tmp_path) -> None:
    data = tmp_path / "data.txt"
    data.write_text("a")
    cache = ProgramCache()
    cache.put(program("k", [run_cache.stat_dep(str(data), "file")]))
    assert cache.get("k") is not None
    data.write_text("bb")
    assert cache.get("k") is None and "k" not in cache


def test_invalidates_on_sibling_edit_same_size_via_mtime(tmp_path) -> None:
    sibling = tmp_path / "helper.py"
    sibling.write_text("V = 1\n")
    cache = ProgramCache()
    cache.put(program("k", [run_cache.stat_dep(str(sibling), "file")]))
    later = time.time() + 5
    sibling.write_text("V = 2\n")
    os.utime(sibling, (later, later))
    assert cache.get("k") is None


def test_invalidates_when_a_listed_directory_gains_a_file(tmp_path) -> None:
    cache = ProgramCache()
    cache.put(program("k", [run_cache.stat_dep(str(tmp_path), "dir")]))
    assert cache.get("k") is not None
    (tmp_path / "new.txt").write_text("x")
    later = time.time() + 5
    os.utime(tmp_path, (later, later))
    assert cache.get("k") is None


def test_invalidates_when_a_missing_file_appears(tmp_path) -> None:
    target = tmp_path / "later.json"
    cache = ProgramCache()
    cache.put(program("k", [run_cache.stat_dep(str(target), "file")]))
    assert cache.get("k") is not None
    target.write_text("{}")
    assert cache.get("k") is None


def test_dep_cap_makes_a_program_uncacheable(tmp_path) -> None:
    from kernel.run_context import DepRecorder

    recorder = DepRecorder(str(tmp_path), ())
    for index in range(run_cache.MAX_DEPS + 5):
        recorder.add(str(tmp_path / f"f{index}.txt"), "file")
    assert recorder.overflow and len(recorder.files) == run_cache.MAX_DEPS


def test_recorder_ignores_paths_outside_the_project_and_library_dirs(tmp_path) -> None:
    from kernel.run_context import DepRecorder

    site = tmp_path / ".venv" / "lib" / "site-packages"
    recorder = DepRecorder(str(tmp_path), (str(site),))
    recorder.add("/etc/hostname", "file")
    recorder.add(str(site / "numpy" / "__init__.py"), "file")
    recorder.add(str(tmp_path / "data.txt"), "file")
    recorder.add(None, "file")
    recorder.add(7, "file")
    assert list(recorder.files) == [str(tmp_path / "data.txt")]
