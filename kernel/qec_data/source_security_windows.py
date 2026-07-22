"""Windows file-handle capabilities for QEC import paths.

The module imports on every platform, but its functions are called only on
Windows. Directory and file handles intentionally omit FILE_SHARE_DELETE so a
verified namespace entry cannot be renamed or deleted while the engine uses it.
"""

from __future__ import annotations

import ctypes
import os
import secrets
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
DELETE = 0x00010000
FILE_READ_ATTRIBUTES = 0x80
FILE_LIST_DIRECTORY = 0x0001
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
OPEN_EXISTING = 3
CREATE_NEW = 1
FILE_ATTRIBUTE_DIRECTORY = 0x10
FILE_ATTRIBUTE_REPARSE_POINT = 0x400
FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class _ByHandleInformation(ctypes.Structure):
    _fields_ = [
        ("attributes", ctypes.c_uint32),
        ("creation_time_low", ctypes.c_uint32),
        ("creation_time_high", ctypes.c_uint32),
        ("access_time_low", ctypes.c_uint32),
        ("access_time_high", ctypes.c_uint32),
        ("write_time_low", ctypes.c_uint32),
        ("write_time_high", ctypes.c_uint32),
        ("volume_serial", ctypes.c_uint32),
        ("size_high", ctypes.c_uint32),
        ("size_low", ctypes.c_uint32),
        ("links", ctypes.c_uint32),
        ("file_index_high", ctypes.c_uint32),
        ("file_index_low", ctypes.c_uint32),
    ]


@dataclass(frozen=True, slots=True)
class DirectoryCapability:
    path: Path
    handle: int
    identity: tuple[int, int]

    def close(self) -> None:
        _close_handle(self.handle)


@dataclass(frozen=True, slots=True)
class DirectoryChain:
    path: Path
    capabilities: tuple[DirectoryCapability, ...]

    def close(self) -> None:
        for capability in reversed(self.capabilities):
            capability.close()


def open_project_directory(
    project_root: Path, expected_identity: tuple[int, int] | None
) -> tuple[Path, DirectoryCapability]:
    capability = _open_directory(Path(project_root))
    if expected_identity is not None and capability.identity != expected_identity:
        capability.close()
        raise PermissionError("project identity changed")
    return capability.path, capability


def secure_directory(
    project: DirectoryCapability, parts: tuple[str, ...]
) -> Path:
    chain = _walk_directories(project, parts, create=True)
    try:
        return chain.path
    finally:
        chain.close()


def open_project_file(project: DirectoryCapability, parts: tuple[str, ...]) -> int:
    chain = _walk_directories(project, parts[:-1], create=False)
    try:
        return _open_file_descriptor(chain.path / parts[-1], writable=False, create=False)
    finally:
        chain.close()


def open_destination_root(
    project: DirectoryCapability, parts: tuple[str, ...]
) -> DirectoryChain:
    return _walk_directories(project, parts, create=False)


def create_destination(
    root: DirectoryChain, session_id: str, file_name: str
) -> tuple[DirectoryCapability, int]:
    session_path = root.path / session_id
    session_path.mkdir(mode=0o700, exist_ok=False)
    session = _open_directory(session_path, deletable=True)
    try:
        descriptor = _open_file_descriptor(
            session.path / file_name, writable=True, create=True
        )
        return session, descriptor
    except Exception:
        session.close()
        session_path.rmdir()
        raise


def open_visible_file(path: Path) -> int:
    return _open_file_descriptor(path, writable=False, create=False)


def create_read_only_copy(descriptor: int) -> tuple[int, Path]:
    temporary_root = Path(tempfile.gettempdir())
    for _ in range(32):
        path = temporary_root / f"nuclei-qec-source-{secrets.token_hex(16)}.tmp"
        try:
            writer = _open_file_descriptor(path, writable=True, create=True)
            break
        except FileExistsError:
            continue
    else:
        raise OSError("could not allocate private QEC source copy")
    try:
        _copy_descriptor(descriptor, writer)
        reader = _duplicate_read_descriptor(writer)
    finally:
        os.close(writer)
    return reader, path


def close_capability_file(descriptor: int, path: Path | None) -> None:
    try:
        mark_delete(descriptor)
    except OSError:
        os.close(descriptor)
        if path is not None:
            path.unlink(missing_ok=True)
    else:
        os.close(descriptor)


def mark_delete(descriptor: int) -> None:
    import msvcrt

    disposition = ctypes.c_ubyte(1)
    handle = msvcrt.get_osfhandle(descriptor)
    if not _kernel32().SetFileInformationByHandle(
        handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)
    ):
        raise ctypes.WinError(ctypes.get_last_error())


def mark_directory_delete(capability: DirectoryCapability) -> None:
    disposition = ctypes.c_ubyte(1)
    if not _kernel32().SetFileInformationByHandle(
        capability.handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)
    ):
        raise ctypes.WinError(ctypes.get_last_error())


def _walk_directories(
    project: DirectoryCapability, parts: tuple[str, ...], *, create: bool
) -> DirectoryChain:
    path = project.path
    opened: list[DirectoryCapability] = []
    try:
        for part in parts:
            path = path / part
            if create:
                path.mkdir(mode=0o700, exist_ok=True)
            capability = _open_directory(path)
            opened.append(capability)
        return DirectoryChain(path, tuple(opened))
    except Exception:
        for capability in reversed(opened):
            capability.close()
        raise


def _open_directory(path: Path, *, deletable: bool = False) -> DirectoryCapability:
    access = FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES
    if deletable:
        access |= DELETE
    handle = _create_file(
        path,
        access,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
    )
    try:
        information = _information(handle)
        invalid = information.attributes & (
            FILE_ATTRIBUTE_REPARSE_POINT
        ) or not information.attributes & FILE_ATTRIBUTE_DIRECTORY
        if invalid:
            raise PermissionError("directory capability is a reparse point")
        canonical = _final_path(handle)
        return DirectoryCapability(canonical, handle, _identity(information))
    except Exception:
        _close_handle(handle)
        raise


def _open_file_descriptor(path: Path, *, writable: bool, create: bool) -> int:
    access = GENERIC_READ | ((GENERIC_WRITE | DELETE) if writable else 0)
    handle = _create_file(
        path,
        access,
        FILE_SHARE_READ,
        CREATE_NEW if create else OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT,
    )
    try:
        information = _information(handle)
        if information.attributes & (
            FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT
        ):
            raise PermissionError("file capability is not a regular file")
        import msvcrt

        flags = os.O_RDWR if writable else os.O_RDONLY
        descriptor = msvcrt.open_osfhandle(handle, flags)
        handle = 0
        return descriptor
    finally:
        if handle:
            _close_handle(handle)


def _copy_descriptor(source: int, destination: int) -> None:
    offset = os.lseek(source, 0, os.SEEK_CUR)
    os.lseek(source, 0, os.SEEK_SET)
    try:
        while chunk := os.read(source, 1024 * 1024):
            view = memoryview(chunk)
            while view:
                view = view[os.write(destination, view) :]
        os.fsync(destination)
    finally:
        os.lseek(source, offset, os.SEEK_SET)


def _duplicate_read_descriptor(descriptor: int) -> int:
    import msvcrt

    kernel = _kernel32()
    process = kernel.GetCurrentProcess()
    source_handle = msvcrt.get_osfhandle(descriptor)
    duplicate = ctypes.c_void_p()
    if not kernel.DuplicateHandle(
        process,
        source_handle,
        process,
        ctypes.byref(duplicate),
        GENERIC_READ | DELETE,
        False,
        0,
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        result = msvcrt.open_osfhandle(int(duplicate.value), os.O_RDONLY)
        duplicate.value = None
        return result
    finally:
        if duplicate.value:
            _close_handle(int(duplicate.value))


def _kernel32() -> Any:
    library = ctypes.WinDLL("kernel32", use_last_error=True)
    library.CreateFileW.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
    ]
    library.CreateFileW.restype = ctypes.c_void_p
    library.GetFileInformationByHandle.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(_ByHandleInformation),
    ]
    library.GetFileInformationByHandle.restype = ctypes.c_int
    library.GetFinalPathNameByHandleW.argtypes = [
        ctypes.c_void_p,
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
    ]
    library.GetFinalPathNameByHandleW.restype = ctypes.c_uint32
    library.SetFileInformationByHandle.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_uint32,
    ]
    library.SetFileInformationByHandle.restype = ctypes.c_int
    library.GetCurrentProcess.restype = ctypes.c_void_p
    library.DuplicateHandle.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint32,
    ]
    library.DuplicateHandle.restype = ctypes.c_int
    library.CloseHandle.argtypes = [ctypes.c_void_p]
    library.CloseHandle.restype = ctypes.c_int
    return library


def _create_file(
    path: Path, access: int, share: int, creation: int, flags: int
) -> int:
    handle = _kernel32().CreateFileW(
        str(path), access, share, None, creation, flags, None
    )
    if handle == INVALID_HANDLE_VALUE:
        error = ctypes.get_last_error()
        if error in {80, 183}:
            raise FileExistsError(error, "path already exists", str(path))
        raise OSError(error, "CreateFileW failed", str(path))
    return int(handle)


def _information(handle: int) -> _ByHandleInformation:
    information = _ByHandleInformation()
    if not _kernel32().GetFileInformationByHandle(handle, ctypes.byref(information)):
        raise ctypes.WinError(ctypes.get_last_error())
    return information


def _identity(information: _ByHandleInformation) -> tuple[int, int]:
    index = information.file_index_high << 32 | information.file_index_low
    return information.volume_serial, index


def _final_path(handle: int) -> Path:
    buffer = ctypes.create_unicode_buffer(32_768)
    length = _kernel32().GetFinalPathNameByHandleW(handle, buffer, len(buffer), 0)
    if not length or length >= len(buffer):
        raise ctypes.WinError(ctypes.get_last_error())
    value = buffer.value
    if value.startswith("\\\\?\\UNC\\"):
        return Path(f"\\\\{value[8:]}")
    return Path(value[4:] if value.startswith("\\\\?\\") else value)


def _close_handle(handle: int) -> None:
    if not _kernel32().CloseHandle(handle):
        raise ctypes.WinError(ctypes.get_last_error())
