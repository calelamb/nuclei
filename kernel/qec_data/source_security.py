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
    descriptor: int
    directory_descriptor: int | None
    root_descriptor: int | None
    directory_name: str
    file_name: str


def secure_canonical_directory(root: Path, parts: tuple[str, ...]) -> Path:
    cursor = root
    for part in parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError("canonical QEC data directory cannot be a symlink")
        cursor.mkdir(exist_ok=True)
        if not cursor.is_dir():
            raise ValueError("canonical QEC data path must be a directory")
    resolved = cursor.resolve(strict=True)
    if root not in resolved.parents:
        raise ValueError("canonical QEC data directory escapes the project")
    return resolved


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
    destination_root = sources_root / session_id
    destination = destination_root / parts[-1]
    root_descriptor = _open_destination_root(sources_root)
    try:
        source_descriptor = _open_project_file(project_root, parts)
    except Exception:
        if root_descriptor is not None:
            os.close(root_descriptor)
        raise
    directory_descriptor: int | None = None
    destination_descriptor: int | None = None
    try:
        directory_descriptor, destination_descriptor = _create_destination(
            sources_root, root_descriptor, session_id, parts[-1]
        )
        digest, byte_size = _copy_descriptors(source_descriptor, destination_descriptor)
        if hasattr(os, "fchmod"):
            os.fchmod(destination_descriptor, 0o400)
        return CopiedSource(
            destination,
            digest,
            byte_size,
            destination_descriptor,
            directory_descriptor,
            root_descriptor,
            session_id,
            parts[-1],
        )
    except Exception:
        _cleanup_failed_destination(
            destination,
            destination_root,
            destination_descriptor,
            directory_descriptor,
            root_descriptor,
            session_id,
            parts[-1],
        )
        raise
    finally:
        os.close(source_descriptor)


def remove_copied_source(source: CopiedSource) -> None:
    release_copied_source(source, remove=True)


def verify_copied_source(source: CopiedSource) -> None:
    if _descriptor_hash(source.descriptor) != source.sha256:
        raise ProtocolError("source_changed", "Copied import source changed.")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        current = os.open(source.path, flags)
    except OSError as error:
        raise ProtocolError("source_changed", "Copied import source moved.") from error
    try:
        expected = os.fstat(source.descriptor)
        actual = os.fstat(current)
        if not _same_file(expected, actual):
            raise ProtocolError("source_changed", "Copied import source changed.")
    finally:
        os.close(current)


def release_copied_source(source: CopiedSource, *, remove: bool) -> None:
    if remove:
        _unlink_copied_source(source)
    os.close(source.descriptor)
    if source.directory_descriptor is not None:
        os.close(source.directory_descriptor)
    if source.root_descriptor is not None:
        os.close(source.root_descriptor)


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


def _copy_descriptors(source: int, destination: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_size = 0
    while chunk := os.read(source, 1024 * 1024):
        _write_all(destination, chunk)
        digest.update(chunk)
        byte_size += len(chunk)
    os.fsync(destination)
    return digest.hexdigest(), byte_size


def _descriptor_hash(descriptor: int) -> str:
    digest = hashlib.sha256()
    offset = os.lseek(descriptor, 0, os.SEEK_CUR)
    os.lseek(descriptor, 0, os.SEEK_SET)
    try:
        while chunk := os.read(descriptor, 1024 * 1024):
            digest.update(chunk)
    finally:
        os.lseek(descriptor, offset, os.SEEK_SET)
    return digest.hexdigest()


def _write_all(descriptor: int, value: bytes) -> None:
    remaining = memoryview(value)
    while remaining:
        written = os.write(descriptor, remaining)
        if written < 1:
            raise OSError("could not write copied import source")
        remaining = remaining[written:]


def _open_destination_root(sources_root: Path) -> int | None:
    if os.mkdir not in os.supports_dir_fd:
        return None
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    return os.open(sources_root, flags)


def _create_destination(
    sources_root: Path,
    root_descriptor: int | None,
    session_id: str,
    file_name: str,
) -> tuple[int | None, int]:
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    if root_descriptor is None:
        directory = sources_root / session_id
        directory.mkdir(exist_ok=False)
        try:
            destination = os.open(directory / file_name, flags, 0o600)
        except Exception:
            directory.rmdir()
            raise
        return None, destination
    os.mkdir(session_id, mode=0o700, dir_fd=root_descriptor)
    directory_flags = (
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    )
    directory_descriptor = os.open(session_id, directory_flags, dir_fd=root_descriptor)
    try:
        destination = os.open(file_name, flags, 0o600, dir_fd=directory_descriptor)
    except Exception:
        os.close(directory_descriptor)
        os.rmdir(session_id, dir_fd=root_descriptor)
        raise
    return directory_descriptor, destination


def _cleanup_failed_destination(
    destination: Path,
    destination_root: Path,
    descriptor: int | None,
    directory_descriptor: int | None,
    root_descriptor: int | None,
    directory_name: str,
    file_name: str,
) -> None:
    if descriptor is not None:
        os.close(descriptor)
    if directory_descriptor is not None and root_descriptor is not None:
        try:
            os.unlink(file_name, dir_fd=directory_descriptor)
            os.rmdir(directory_name, dir_fd=root_descriptor)
        except OSError:
            pass
        os.close(directory_descriptor)
        os.close(root_descriptor)
        return
    if root_descriptor is not None:
        os.close(root_descriptor)
    if descriptor is not None:
        _remove_destination(destination, destination_root)


def _unlink_copied_source(source: CopiedSource) -> None:
    if source.directory_descriptor is not None and source.root_descriptor is not None:
        try:
            os.unlink(source.file_name, dir_fd=source.directory_descriptor)
            os.rmdir(source.directory_name, dir_fd=source.root_descriptor)
        except OSError:
            pass
        return
    current: int | None = None
    try:
        current = os.open(source.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        if _same_file(os.fstat(source.descriptor), os.fstat(current)):
            source.path.unlink(missing_ok=True)
            source.path.parent.rmdir()
    except OSError:
        pass
    finally:
        if current is not None:
            os.close(current)


def _remove_destination(destination: Path, destination_root: Path) -> None:
    try:
        destination.unlink(missing_ok=True)
        destination_root.rmdir()
    except OSError:
        pass


def _unauthorized(message: str) -> ProtocolError:
    return ProtocolError("source_not_authorized", message)
