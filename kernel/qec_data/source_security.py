"""Capability-style snapshots for project-local QEC import sources."""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .protocol import ProtocolError


@dataclass(frozen=True, slots=True)
class CopiedSource:
    path: Path
    sha256: str
    byte_size: int


def source_parts(raw_source: object) -> tuple[str, ...]:
    if type(raw_source) is not str or "\\" in raw_source:
        raise _unauthorized("Source path is not authorized.")
    relative = PurePosixPath(raw_source)
    if relative.is_absolute() or any(
        part in {"", ".", ".."} for part in relative.parts
    ):
        raise _unauthorized("Source path is not authorized.")
    if relative.parts[0].casefold() == "qec-data":
        raise _unauthorized("Canonical data cannot be an import source.")
    return relative.parts


def resolve_authorized_source(project_root: Path, raw_source: object) -> Path:
    parts = source_parts(raw_source)
    candidate = project_root.joinpath(*parts)
    cursor = project_root
    for part in parts:
        cursor = cursor / part
        try:
            mode = cursor.lstat().st_mode
        except OSError as error:
            raise _unauthorized("Source path is unavailable.") from error
        if stat.S_ISLNK(mode):
            raise _unauthorized("Source path contains a symlink.")
    resolved = candidate.resolve(strict=True)
    if project_root not in resolved.parents or not resolved.is_file():
        raise _unauthorized("Source path is not authorized.")
    return resolved


def copy_authorized_source(
    project_root: Path,
    sources_root: Path,
    raw_source: object,
    session_id: str,
) -> CopiedSource:
    validate_session_id(session_id)
    parts = source_parts(raw_source)
    descriptor = _open_project_file(project_root, parts)
    destination_root = sources_root / session_id
    destination = destination_root / parts[-1]
    destination_created = False
    try:
        destination_root.mkdir(exist_ok=False)
        destination_created = True
        digest, byte_size = _copy_descriptor(descriptor, destination)
        return CopiedSource(destination.resolve(strict=True), digest, byte_size)
    except Exception:
        if destination_created:
            _remove_destination(destination, destination_root)
        raise
    finally:
        os.close(descriptor)


def remove_copied_source(source: Path) -> None:
    _remove_destination(source, source.parent)


def validate_session_id(session_id: str) -> None:
    forbidden = frozenset('<>:"/\\|?*')
    if (
        not session_id
        or session_id in {".", ".."}
        or any(
            character in forbidden or ord(character) < 32 for character in session_id
        )
    ):
        raise ProtocolError("invalid_request", "Session ID is invalid.")


def _open_project_file(project_root: Path, parts: tuple[str, ...]) -> int:
    if os.open in os.supports_dir_fd:
        return _open_relative_file(project_root, parts)
    source_name = PurePosixPath(*parts).as_posix()
    resolved = resolve_authorized_source(project_root, source_name)
    expected = resolved.stat(follow_symlinks=False)
    descriptor = os.open(resolved, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        _require_regular(descriptor)
        confirmed = resolve_authorized_source(project_root, source_name)
        if confirmed != resolved or not _same_file(expected, os.fstat(descriptor)):
            raise _unauthorized("Source changed while it was being opened.")
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def _open_relative_file(project_root: Path, parts: tuple[str, ...]) -> int:
    directory_flags = (
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    )
    directory = os.open(project_root, directory_flags)
    try:
        for part in parts[:-1]:
            child = os.open(part, directory_flags, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(
            parts[-1], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory
        )
        try:
            _require_regular(descriptor)
        except Exception:
            os.close(descriptor)
            raise
        return descriptor
    except OSError as error:
        raise _unauthorized("Source path cannot be opened safely.") from error
    finally:
        os.close(directory)


def _require_regular(descriptor: int) -> None:
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        raise _unauthorized("Source must be a regular file.")


def _same_file(expected: os.stat_result, opened: os.stat_result) -> bool:
    return (
        expected.st_dev,
        expected.st_ino,
        expected.st_size,
        expected.st_mtime_ns,
    ) == (
        opened.st_dev,
        opened.st_ino,
        opened.st_size,
        opened.st_mtime_ns,
    )


def _copy_descriptor(descriptor: int, destination: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_size = 0
    with os.fdopen(os.dup(descriptor), "rb") as input_stream:
        with destination.open("xb") as output_stream:
            while chunk := input_stream.read(1024 * 1024):
                output_stream.write(chunk)
                digest.update(chunk)
                byte_size += len(chunk)
            output_stream.flush()
            os.fsync(output_stream.fileno())
    return digest.hexdigest(), byte_size


def _remove_destination(destination: Path, destination_root: Path) -> None:
    try:
        destination.unlink(missing_ok=True)
        destination_root.rmdir()
    except OSError:
        pass


def _unauthorized(message: str) -> ProtocolError:
    return ProtocolError("source_not_authorized", message)
