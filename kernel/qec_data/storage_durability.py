"""Platform-specific durable publication for QEC storage files."""

from __future__ import annotations

import errno
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


MOVEFILE_REPLACE_EXISTING = 0x00000001
MOVEFILE_WRITE_THROUGH = 0x00000008
UNSUPPORTED_DIRECTORY_SYNC = {
    errno.EBADF,
    errno.EINVAL,
    getattr(errno, "ENOTSUP", errno.EINVAL),
}

DirectorySync = Callable[[Path], object]
WindowsMove = Callable[[Path, Path, int], bool | None]


def fsync_directory(path: Path) -> bool:
    """Sync POSIX directory metadata; reject use as a Windows durability claim."""

    if os.name != "posix":
        raise OSError(errno.ENOTSUP, "directory fsync is only supported on POSIX")
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError as error:
        if error.errno in UNSUPPORTED_DIRECTORY_SYNC:
            return False
        raise
    try:
        os.fsync(descriptor)
    except OSError as error:
        if error.errno not in UNSUPPORTED_DIRECTORY_SYNC:
            raise
        return False
    finally:
        os.close(descriptor)
    return True


def _move_file_ex_windows(source: Path, target: Path, flags: int) -> bool:
    """Call MoveFileExW and preserve the native Windows failure details."""

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    move_file = kernel32.MoveFileExW
    move_file.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD)
    move_file.restype = wintypes.BOOL
    if not move_file(str(source), str(target), flags):
        raise ctypes.WinError(ctypes.get_last_error())
    return True


@dataclass(frozen=True, slots=True)
class DurableMover:
    """Publish one filesystem entry with platform-appropriate durability."""

    platform: str = os.name
    windows_move: WindowsMove | None = None
    directory_sync: DirectorySync = fsync_directory

    def sync_directory(self, path: Path) -> None:
        """Sync directory metadata only on platforms with that primitive."""

        if self.platform == "posix":
            self.directory_sync(path)
            return
        if self.platform == "nt":
            return
        raise OSError(errno.ENOTSUP, f"unsupported storage platform: {self.platform}")

    def move(
        self, source: Path, target: Path, *, replace_existing: bool = False
    ) -> None:
        if self.platform == "posix":
            operation = os.replace if replace_existing else os.rename
            operation(source, target)
            self.sync_directory(source.parent)
            if target.parent != source.parent:
                self.sync_directory(target.parent)
            return
        if self.platform == "nt":
            flags = MOVEFILE_WRITE_THROUGH
            if replace_existing:
                flags |= MOVEFILE_REPLACE_EXISTING
            operation = self.windows_move or _move_file_ex_windows
            if operation(source, target, flags) is False:
                raise OSError(errno.EIO, "MoveFileExW reported failure")
            return
        raise OSError(errno.ENOTSUP, f"unsupported storage platform: {self.platform}")
