"""Capability-style snapshots for project-local QEC import sources."""

from __future__ import annotations

import hashlib
import os
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from .protocol import ProtocolError


PROJECT_DEVICE_ENVIRONMENT_VARIABLE = "NUCLEI_QEC_DATA_PROJECT_DEVICE"
PROJECT_INODE_ENVIRONMENT_VARIABLE = "NUCLEI_QEC_DATA_PROJECT_INODE"
PROJECT_VOLUME_ENVIRONMENT_VARIABLE = "NUCLEI_QEC_DATA_PROJECT_VOLUME"
PROJECT_FILE_INDEX_ENVIRONMENT_VARIABLE = "NUCLEI_QEC_DATA_PROJECT_FILE_INDEX"


class CapabilitySource:
    """Path-compatible, read-only view backed by an anonymous file descriptor."""

    is_capability_source = True

    def __init__(
        self, descriptor: int, display_name: str, cleanup_path: Path | None = None
    ) -> None:
        self.__descriptor = descriptor
        self.__name = display_name
        self.__cleanup_path = cleanup_path

    @property
    def name(self) -> str:
        return self.__name

    @property
    def suffix(self) -> str:
        return Path(self.__name).suffix

    def open(self, mode: str = "r", *args: object, **kwargs: object) -> BinaryIO:
        if mode != "rb" or args or kwargs:
            raise ValueError("capability sources support binary reads only")
        duplicate = os.dup(self.__descriptor)
        os.lseek(duplicate, 0, os.SEEK_SET)
        return os.fdopen(duplicate, "rb")

    def stat(self, *, follow_symlinks: bool = True) -> os.stat_result:
        del follow_symlinks
        return os.fstat(self.__descriptor)

    def lstat(self) -> os.stat_result:
        return os.fstat(self.__descriptor)

    def is_file(self) -> bool:
        return True

    def is_dir(self) -> bool:
        return False

    def __fspath__(self) -> str:
        if os.name == "posix":
            return f"/dev/fd/{self.__descriptor}"
        return f"<qec-source-handle:{self.__descriptor}>"

    def __str__(self) -> str:
        return self.__fspath__()

    def close(self) -> None:
        if os.name == "nt":
            from .source_security_windows import close_capability_file

            close_capability_file(self.__descriptor, self.__cleanup_path)
        else:
            os.close(self.__descriptor)

    def fileno(self) -> int:
        return self.__descriptor


@dataclass(frozen=True, slots=True)
class CopiedSource:
    path: Path
    sha256: str
    byte_size: int
    descriptor: int
    directory_descriptor: object | None
    root_descriptor: object | None
    directory_name: str
    file_name: str
    capability: CapabilitySource


def secure_canonical_directory(
    root: Path, project_descriptor: object, parts: tuple[str, ...]
) -> Path:
    if os.name == "nt":
        from .source_security_windows import secure_directory

        return secure_directory(project_descriptor, parts)
    _require_directory_capabilities()
    directory = os.dup(_unix_descriptor(project_descriptor))
    try:
        for part in parts:
            try:
                os.mkdir(part, mode=0o700, dir_fd=directory)
            except FileExistsError:
                pass
            child = os.open(part, _directory_flags(), dir_fd=directory)
            os.close(directory)
            directory = child
    finally:
        os.close(directory)
    return root.joinpath(*parts)


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
    project_descriptor: object,
    sources_root: Path,
    raw_source: object,
    session_id: str,
) -> CopiedSource:
    parts, destination_root, destination, root_descriptor = _copy_locations(
        project_root, project_descriptor, sources_root, raw_source, session_id
    )
    try:
        source_descriptor = _open_project_file(project_descriptor, parts)
    except Exception:
        _close_directory_capability(root_descriptor)
        raise
    directory_descriptor: object | None = None
    destination_descriptor: int | None = None
    try:
        directory_descriptor, destination_descriptor = _create_destination(
            sources_root, root_descriptor, session_id, parts[-1]
        )
        digest, byte_size = _copy_descriptors(source_descriptor, destination_descriptor)
        if os.name != "nt" and hasattr(os, "fchmod"):
            os.fchmod(destination_descriptor, 0o400)
        capability = _anonymous_capability(destination_descriptor, parts[-1])
        return _copied_source(
            destination,
            digest,
            byte_size,
            destination_descriptor,
            directory_descriptor,
            root_descriptor,
            session_id,
            parts[-1],
            capability,
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


def _copy_locations(
    project_root: Path,
    project_descriptor: object,
    sources_root: Path,
    raw_source: object,
    session_id: str,
) -> tuple[tuple[str, ...], Path, Path, object]:
    validate_session_id(session_id)
    parts = source_parts(raw_source)
    destination_root = sources_root / session_id
    destination = destination_root / parts[-1]
    relative = sources_root.relative_to(project_root).parts
    descriptor = _open_destination_root(project_descriptor, relative)
    return parts, destination_root, destination, descriptor


def _copied_source(
    path: Path,
    digest: str,
    byte_size: int,
    descriptor: int,
    directory_descriptor: object,
    root_descriptor: object,
    directory_name: str,
    file_name: str,
    capability: CapabilitySource,
) -> CopiedSource:
    return CopiedSource(
        path,
        digest,
        byte_size,
        descriptor,
        directory_descriptor,
        root_descriptor,
        directory_name,
        file_name,
        capability,
    )


def remove_copied_source(source: CopiedSource) -> None:
    release_copied_source(source, remove=True)


def verify_copied_source(source: CopiedSource) -> None:
    if _capability_hash(source.capability) != source.sha256:
        raise ProtocolError("source_changed", "Held import source changed.")
    if _descriptor_hash(source.descriptor) != source.sha256:
        raise ProtocolError("source_changed", "Copied import source changed.")
    try:
        current = _open_visible_source(source.path)
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
    if os.name == "nt":
        _release_windows_source(source, remove=remove)
        return
    if remove:
        _unlink_copied_source(source)
    os.close(source.descriptor)
    if source.directory_descriptor is not None:
        os.close(source.directory_descriptor)
    if source.root_descriptor is not None:
        os.close(source.root_descriptor)
    source.capability.close()


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


def open_project_directory(
    project_root: Path, expected_identity: tuple[int, int] | None = None
) -> tuple[Path, object]:
    """Open and retain the project namespace before resolving its display path."""

    if os.name == "nt":
        from .source_security_windows import open_project_directory as windows_open

        try:
            return windows_open(project_root, expected_identity)
        except PermissionError as error:
            raise ProtocolError(
                "project_identity_changed", "Project identity changed."
            ) from error
    _require_directory_capabilities()
    try:
        descriptor = os.open(project_root, _directory_flags())
    except OSError as error:
        raise ProtocolError("invalid_project_root", "Project root is unavailable.") from error
    try:
        opened = os.fstat(descriptor)
        if expected_identity is not None and (opened.st_dev, opened.st_ino) != expected_identity:
            raise ProtocolError("project_identity_changed", "Project identity changed.")
        resolved = Path(project_root).resolve(strict=True)
        current = os.stat(resolved, follow_symlinks=False)
        if not stat.S_ISDIR(opened.st_mode) or not _same_identity(opened, current):
            raise ProtocolError("project_identity_changed", "Project identity changed.")
        return resolved, descriptor
    except Exception:
        os.close(descriptor)
        raise


def project_identity_from_environment() -> tuple[int, int]:
    try:
        names = (
            (PROJECT_VOLUME_ENVIRONMENT_VARIABLE, PROJECT_FILE_INDEX_ENVIRONMENT_VARIABLE)
            if os.name == "nt"
            else (PROJECT_DEVICE_ENVIRONMENT_VARIABLE, PROJECT_INODE_ENVIRONMENT_VARIABLE)
        )
        first, second = (os.environ[name] for name in names)
        if not first.isdecimal() or not second.isdecimal():
            raise ValueError
        return int(first), int(second)
    except (KeyError, ValueError) as error:
        raise ProtocolError(
            "project_identity_unavailable", "Project identity is unavailable."
        ) from error


def _open_project_file(project_descriptor: object, parts: tuple[str, ...]) -> int:
    if os.name == "nt":
        from .source_security_windows import open_project_file

        return open_project_file(project_descriptor, parts)
    _require_directory_capabilities()
    return _open_relative_file(_unix_descriptor(project_descriptor), parts)


def _open_relative_file(project_descriptor: int, parts: tuple[str, ...]) -> int:
    directory = os.dup(project_descriptor)
    try:
        for part in parts[:-1]:
            child = os.open(part, _directory_flags(), dir_fd=directory)
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


def _same_identity(expected: os.stat_result, opened: os.stat_result) -> bool:
    return (expected.st_dev, expected.st_ino) == (opened.st_dev, opened.st_ino)


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


def _capability_hash(source: CapabilitySource) -> str:
    with source.open("rb") as source_file:
        return hashlib.file_digest(source_file, "sha256").hexdigest()


def _open_visible_source(path: Path) -> int:
    if os.name == "nt":
        from .source_security_windows import open_visible_file

        return open_visible_file(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    return os.open(path, flags)


def _anonymous_capability(descriptor: int, display_name: str) -> CapabilitySource:
    if os.name == "nt":
        from .source_security_windows import create_read_only_copy

        reader, cleanup_path = create_read_only_copy(descriptor)
        return CapabilitySource(reader, display_name, cleanup_path)
    private_root = Path(tempfile.mkdtemp(prefix="nuclei-qec-source-"))
    writer, temporary_name = tempfile.mkstemp(dir=private_root)
    try:
        source_offset = os.lseek(descriptor, 0, os.SEEK_CUR)
        os.lseek(descriptor, 0, os.SEEK_SET)
        try:
            while chunk := os.read(descriptor, 1024 * 1024):
                _write_all(writer, chunk)
        finally:
            os.lseek(descriptor, source_offset, os.SEEK_SET)
        os.fsync(writer)
        written = os.fstat(writer)
        if hasattr(os, "fchmod"):
            os.fchmod(writer, 0o400)
        os.close(writer)
        writer = -1
        reader = os.open(
            temporary_name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        )
        if not _same_file(written, os.fstat(reader)):
            os.close(reader)
            raise ProtocolError("source_changed", "Private source copy changed.")
        os.unlink(temporary_name)
        return CapabilitySource(reader, display_name)
    finally:
        if writer >= 0:
            os.close(writer)
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        private_root.rmdir()


def _write_all(descriptor: int, value: bytes) -> None:
    remaining = memoryview(value)
    while remaining:
        written = os.write(descriptor, remaining)
        if written < 1:
            raise OSError("could not write copied import source")
        remaining = remaining[written:]


def _open_destination_root(
    project_descriptor: object, parts: tuple[str, ...]
) -> object:
    if os.name == "nt":
        from .source_security_windows import open_destination_root

        return open_destination_root(project_descriptor, parts)
    _require_directory_capabilities()
    directory = os.dup(_unix_descriptor(project_descriptor))
    try:
        for part in parts:
            child = os.open(part, _directory_flags(), dir_fd=directory)
            os.close(directory)
            directory = child
        return directory
    except Exception:
        os.close(directory)
        raise


def _create_destination(
    sources_root: Path,
    root_descriptor: object,
    session_id: str,
    file_name: str,
) -> tuple[object, int]:
    if os.name == "nt":
        from .source_security_windows import create_destination

        return create_destination(root_descriptor, session_id, file_name)
    unix_root = _unix_descriptor(root_descriptor)
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    del sources_root
    os.mkdir(session_id, mode=0o700, dir_fd=unix_root)
    directory_descriptor = os.open(session_id, _directory_flags(), dir_fd=unix_root)
    try:
        destination = os.open(file_name, flags, 0o600, dir_fd=directory_descriptor)
    except Exception:
        os.close(directory_descriptor)
        os.rmdir(session_id, dir_fd=unix_root)
        raise
    return directory_descriptor, destination


def _cleanup_failed_destination(
    destination: Path,
    destination_root: Path,
    descriptor: int | None,
    directory_descriptor: object | None,
    root_descriptor: object | None,
    directory_name: str,
    file_name: str,
) -> None:
    if os.name == "nt":
        _cleanup_failed_windows_destination(
            descriptor, directory_descriptor, root_descriptor
        )
        return
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


def _directory_flags() -> int:
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _require_directory_capabilities() -> None:
    supported = (
        os.name == "posix"
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and os.open in os.supports_dir_fd
        and os.mkdir in os.supports_dir_fd
        and os.unlink in os.supports_dir_fd
    )
    if not supported:
        raise ProtocolError(
            "capability_unavailable",
            "Secure project directory capabilities are unavailable.",
        )


def _unix_descriptor(descriptor: object) -> int:
    if type(descriptor) is not int:
        raise ProtocolError("capability_unavailable", "Directory capability is invalid.")
    return descriptor


def _close_directory_capability(capability: object | None) -> None:
    if capability is None:
        return
    if os.name == "nt":
        capability.close()
    else:
        os.close(_unix_descriptor(capability))


def close_project_directory(capability: object) -> None:
    _close_directory_capability(capability)


def _release_windows_source(source: CopiedSource, *, remove: bool) -> None:
    from .source_security_windows import mark_delete, mark_directory_delete

    failure: OSError | None = None
    try:
        if remove:
            mark_delete(source.descriptor)
    except OSError as error:
        failure = error
    finally:
        os.close(source.descriptor)
    try:
        if remove and source.directory_descriptor is not None:
            mark_directory_delete(source.directory_descriptor)
    except OSError as error:
        failure = failure or error
    finally:
        _close_directory_capability(source.directory_descriptor)
        _close_directory_capability(source.root_descriptor)
        source.capability.close()
    if failure is not None:
        raise failure


def _cleanup_failed_windows_destination(
    descriptor: int | None,
    directory: object | None,
    root: object | None,
) -> None:
    from .source_security_windows import mark_delete, mark_directory_delete

    failure: OSError | None = None
    try:
        if descriptor is not None:
            mark_delete(descriptor)
    except OSError as error:
        failure = error
    finally:
        if descriptor is not None:
            os.close(descriptor)
    try:
        if directory is not None:
            mark_directory_delete(directory)
    except OSError as error:
        failure = failure or error
    finally:
        _close_directory_capability(directory)
        _close_directory_capability(root)
    if failure is not None:
        raise failure
