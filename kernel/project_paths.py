"""Validation of the paths a request hands the kernel (audit R-9).

``project_root`` becomes the user program's working directory and the head of its
``sys.path``; ``file_path`` becomes ``__file__``; ``run_dir`` is where it may write results.
All three come from the wire, so none is trusted: every path is resolved through symlinks and
must stay inside the root.  Violations raise :class:`PathError`, which the server turns into an
``invalid_path`` error before any user code runs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

MAX_PATH_CHARS = 4096


class PathError(ValueError):
    def __init__(self, field: str, path: object, message: str):
        super().__init__(message)
        self.field = field
        self.path = path if isinstance(path, str) else repr(path)
        self.message = message

    def to_error_fields(self) -> dict:
        return {"field": self.field, "path": self.path[:200]}


@dataclass(frozen=True)
class ProjectPaths:
    project_root: str | None
    file_path: str | None
    run_dir: str | None


def _text(field: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        raise PathError(field, value, f"`{field}` must be a non-empty string.")
    if len(value) > MAX_PATH_CHARS:
        raise PathError(field, value, f"`{field}` is longer than {MAX_PATH_CHARS} characters.")
    if "\0" in value:
        raise PathError(field, value, f"`{field}` contains a NUL character.")
    return value


def _is_inside(root: str, candidate: str) -> bool:
    try:
        return os.path.commonpath([root, candidate]) == root
    except ValueError:  # different drives on Windows
        return False


def _resolve_root(project_root: object) -> str:
    text = _text("project_root", project_root)
    if not os.path.isabs(text):
        raise PathError("project_root", text, "`project_root` must be an absolute path.")
    real = os.path.realpath(text)
    if not os.path.isdir(real):
        raise PathError("project_root", text, "`project_root` is not an existing directory.")
    if os.path.dirname(real) == real:
        raise PathError("project_root", text, "`project_root` cannot be a filesystem root.")
    return real


def _inside(field: str, root: str, value: object) -> str:
    text = _text(field, value)
    joined = text if os.path.isabs(text) else os.path.join(root, text)
    real = os.path.realpath(joined)
    if not _is_inside(root, real):
        raise PathError(field, text, f"`{field}` must stay inside the project root.")
    return real


def _nearest_existing(path: str) -> str:
    current = path
    while not os.path.lexists(current):
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return current


def _prepare_run_dir(root: str, value: object) -> str:
    target = _inside("run_dir", root, value)  # resolves the existing prefix through symlinks
    ancestor = _nearest_existing(target)
    if not _is_inside(root, os.path.realpath(ancestor)):
        raise PathError("run_dir", str(value), "`run_dir` must stay inside the project root.")
    try:
        os.makedirs(target, exist_ok=True)
    except OSError as exc:
        raise PathError("run_dir", str(value), f"`run_dir` could not be created: {exc.strerror or exc}") from exc
    final = os.path.realpath(target)
    if not _is_inside(root, final):
        raise PathError("run_dir", str(value), "`run_dir` must stay inside the project root.")
    return final


def resolve(project_root: object, file_path: object, run_dir: object) -> ProjectPaths:
    """Validate the three request fields; ``None`` means "not supplied"."""
    if project_root is None:
        for field, value in (("file_path", file_path), ("run_dir", run_dir)):
            if value is not None:
                raise PathError(field, value, f"`{field}` requires a `project_root`.")
        return ProjectPaths(None, None, None)
    root = _resolve_root(project_root)
    resolved_file = None if file_path is None else _inside("file_path", root, file_path)
    resolved_run = None if run_dir is None else _prepare_run_dir(root, run_dir)
    return ProjectPaths(root, resolved_file, resolved_run)
