"""Symlink-safe containment helpers for QEC session storage."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath


def require_storage_root(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("storage root cannot be a symlink")
    if not path.is_dir():
        raise ValueError("storage root must be a directory")
    return path.resolve(strict=True)


def validate_relative_path(value: object) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("storage path is invalid")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(
        part in {"", ".", ".."} for part in relative.parts
    ):
        raise ValueError("storage path escapes the session root")
    return relative


def _assert_directory(path: Path) -> None:
    if path.is_symlink():
        raise ValueError(f"storage directory is a symlink: {path.name}")
    if not path.is_dir():
        raise ValueError(f"storage directory is missing or invalid: {path.name}")


def assert_session_root(session_root: Path) -> None:
    _assert_directory(session_root)
    resolved = session_root.resolve(strict=True)
    if resolved != session_root:
        raise ValueError("session root changed or contains a symlink")


def secure_directory(
    session_root: Path, relative: str, *, create: bool = False
) -> Path:
    assert_session_root(session_root)
    parsed = validate_relative_path(relative)
    cursor = session_root
    for part in parsed.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError(f"storage directory is a symlink: {part}")
        if not cursor.exists():
            if not create:
                raise ValueError(f"storage directory is missing: {part}")
            cursor.mkdir()
        _assert_directory(cursor)
    if session_root not in cursor.resolve(strict=True).parents:
        raise ValueError("storage directory escapes the session root")
    return cursor


def safe_session_file(session_root: Path, relative: object) -> Path:
    parsed = validate_relative_path(relative)
    parent_parts = parsed.parts[:-1]
    if parent_parts:
        secure_directory(session_root, PurePosixPath(*parent_parts).as_posix())
    else:
        assert_session_root(session_root)
    candidate = session_root.joinpath(*parsed.parts)
    if candidate.is_symlink():
        raise ValueError("storage file is a symlink")
    resolved = candidate.resolve(strict=False)
    if resolved != session_root and session_root not in resolved.parents:
        raise ValueError("storage file escapes the session root")
    return candidate


def walk_storage_files(
    session_root: Path, relative_directory: str, suffix: str
) -> tuple[Path, ...]:
    root = secure_directory(session_root, relative_directory)
    found: list[Path] = []
    for current, directories, files in os.walk(root, followlinks=False):
        base = Path(current)
        for name in directories:
            if (base / name).is_symlink():
                raise ValueError(f"storage directory is a symlink: {name}")
        for name in files:
            path = base / name
            if name.endswith(suffix):
                if path.is_symlink():
                    raise ValueError("storage file is a symlink")
                found.append(path)
    return tuple(sorted(found))
