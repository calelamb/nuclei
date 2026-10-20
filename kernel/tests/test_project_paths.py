"""R-9: project_root / file_path / run_dir validation (no traversal, no escape)."""

from __future__ import annotations

import os

import pytest

from kernel.project_paths import PathError, ProjectPaths, resolve


def test_no_root_means_no_paths() -> None:
    assert resolve(None, None, None) == ProjectPaths(None, None, None)


def test_valid_root_and_relative_file(tmp_path) -> None:
    (tmp_path / "sub").mkdir()
    paths = resolve(str(tmp_path), "sub/main.py", None)
    assert paths.project_root == os.path.realpath(tmp_path)
    assert paths.file_path == os.path.join(os.path.realpath(tmp_path), "sub", "main.py")
    assert paths.run_dir is None


def test_absolute_file_inside_root_and_unsaved_file(tmp_path) -> None:
    target = tmp_path / "unsaved.py"  # does not exist yet
    assert resolve(str(tmp_path), str(target), None).file_path == os.path.realpath(target)


def test_run_dir_is_created_inside_the_root(tmp_path) -> None:
    paths = resolve(str(tmp_path), None, "experiments/theta/runs/20260101-a1")
    assert paths.run_dir is not None and os.path.isdir(paths.run_dir)
    assert paths.run_dir.startswith(os.path.realpath(tmp_path))


@pytest.mark.parametrize(
    "root_factory, field",
    [
        (lambda tmp: "relative/dir", "project_root"),
        (lambda tmp: str(tmp / "missing"), "project_root"),
        (lambda tmp: "/", "project_root"),
        (lambda tmp: "bad\0root", "project_root"),
        (lambda tmp: 7, "project_root"),
        (lambda tmp: "/" + "a" * 5000, "project_root"),
    ],
)
def test_bad_roots(tmp_path, root_factory, field) -> None:
    with pytest.raises(PathError) as err:
        resolve(root_factory(tmp_path), None, None)
    assert err.value.field == field


def test_root_must_be_a_directory(tmp_path) -> None:
    afile = tmp_path / "f.py"
    afile.write_text("x = 1")
    with pytest.raises(PathError, match="directory"):
        resolve(str(afile), None, None)


def test_file_dotdot_is_refused(tmp_path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    with pytest.raises(PathError) as err:
        resolve(str(root), "../outside.py", None)
    assert err.value.field == "file_path"


def test_run_dir_dotdot_is_refused_and_creates_nothing(tmp_path) -> None:
    root = tmp_path / "proj"
    root.mkdir()
    with pytest.raises(PathError) as err:
        resolve(str(root), None, "../escaped/runs")
    assert err.value.field == "run_dir"
    assert not (tmp_path / "escaped").exists()


def test_symlink_escape_is_refused(tmp_path) -> None:
    root = tmp_path / "proj"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "main.py").write_text("x = 1")
    os.symlink(outside, root / "link")
    with pytest.raises(PathError):
        resolve(str(root), "link/main.py", None)
    with pytest.raises(PathError):
        resolve(str(root), None, "link/runs")
    assert not (outside / "runs").exists()


def test_file_must_be_a_string(tmp_path) -> None:
    with pytest.raises(PathError):
        resolve(str(tmp_path), 5, None)


def test_file_or_run_dir_without_root_is_refused() -> None:
    with pytest.raises(PathError, match="project_root"):
        resolve(None, "main.py", None)
    with pytest.raises(PathError, match="project_root"):
        resolve(None, None, "runs/a")
