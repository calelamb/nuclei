"""Linux Landlock confinement for the candidate sandbox (PRD 15 R-19).

Landlock is an unprivileged, stackable LSM (kernel 5.13+): a process restricts
*itself* and everything it later executes. It is the isolation tier for hosts where
``bwrap`` is blocked (Ubuntu 24.04: ``kernel.apparmor_restrict_unprivileged_userns=1``).

Two halves live here, deliberately stdlib-only so the file can run as a script:

* the library half (:func:`abi_version`, :func:`build_spec`, :func:`wrap_command`) is
  imported by ``isolation.py`` to probe the ABI and build the wrapped command line;
* the script half (:func:`main`) is the *trusted launcher*. It runs as
  ``python -I landlock.py <spec-json> -- <worker argv>``: it builds the ruleset from the
  spec, sets ``no_new_privs``, calls ``landlock_restrict_self`` and only then
  starts the candidate worker with ``execv``. The candidate therefore never runs a single
  instruction outside the ruleset, and no new dependency is needed (raw ``syscall(2)`` via ctypes).

Policy: read-only (+execute) on the interpreter prefixes, ``kernel/`` and system
libraries; read-write on the per-evaluation scratch directory only; optional extra
read-only roots (the project root, on request); TCP ``connect``/``bind`` denied on
ABI >= 4; abstract UNIX sockets and signals to other domains denied on ABI >= 6.
A right that is *handled* but never granted is denied, so everything not listed is out.
"""

from __future__ import annotations

import ctypes
import json
import os
import sys

# Syscall numbers are identical on every architecture since the unified table (5.13).
_SYS_CREATE_RULESET = 444
_SYS_ADD_RULE = 445
_SYS_RESTRICT_SELF = 446
_CREATE_RULESET_VERSION = 1 << 0
_RULE_PATH_BENEATH = 1
_PR_SET_NO_NEW_PRIVS = 38

# Filesystem access bits (include/uapi/linux/landlock.h) with the ABI that introduced them.
_FS_EXECUTE = 1 << 0
_FS_WRITE_FILE = 1 << 1
_FS_READ_FILE = 1 << 2
_FS_READ_DIR = 1 << 3
_FS_REMOVE_DIR = 1 << 4
_FS_REMOVE_FILE = 1 << 5
_FS_MAKE_BITS = 0x1FC0  # CHAR, DIR, REG, SOCK, FIFO, BLOCK, SYM (bits 6..12)
_FS_REFER = 1 << 13  # ABI 2
_FS_TRUNCATE = 1 << 14  # ABI 3
_FS_IOCTL_DEV = 1 << 15  # ABI 5
_NET_BIND_TCP = 1 << 0  # ABI 4
_NET_CONNECT_TCP = 1 << 1  # ABI 4
_SCOPE_ABSTRACT_UNIX = 1 << 0  # ABI 6
_SCOPE_SIGNAL = 1 << 1  # ABI 6

_FS_READ = _FS_READ_FILE | _FS_READ_DIR
_FS_FILE_RIGHTS = _FS_EXECUTE | _FS_WRITE_FILE | _FS_READ_FILE | _FS_TRUNCATE | _FS_IOCTL_DEV

# Device nodes Python and numpy touch; (path, wants write).
_DEVICE_FILES = (("/dev/null", True), ("/dev/zero", False), ("/dev/urandom", False), ("/dev/random", False))

EXIT_LANDLOCK_FAILED = 71


def _syscall():
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    return libc


def abi_version() -> int:
    """The kernel's Landlock ABI version, or 0 when Landlock is missing or disabled."""
    if not sys.platform.startswith("linux"):
        return 0
    try:
        libc = _syscall()
        version = libc.syscall(_SYS_CREATE_RULESET, None, ctypes.c_size_t(0), ctypes.c_uint32(_CREATE_RULESET_VERSION))
    except (OSError, AttributeError):
        return 0
    return int(version) if version > 0 else 0


def handled_fs_access(abi: int) -> int:
    """Every filesystem right the running ABI understands (all handled => all denied unless granted)."""
    access = _FS_EXECUTE | _FS_WRITE_FILE | _FS_READ | _FS_REMOVE_DIR | _FS_REMOVE_FILE | _FS_MAKE_BITS
    if abi >= 2:
        access |= _FS_REFER
    if abi >= 3:
        access |= _FS_TRUNCATE
    if abi >= 5:
        access |= _FS_IOCTL_DEV
    return access


def denies_tcp(abi: int) -> bool:
    return abi >= 4


def _scratch_rights(abi: int) -> int:
    """Everything except execute: scratch is writable, never a place to run dropped code from."""
    return handled_fs_access(abi) & ~_FS_EXECUTE


def _ro_rights(abi: int) -> int:
    return (_FS_EXECUTE | _FS_READ) & handled_fs_access(abi)


def build_spec(
    read_roots: list[str],
    scratch: str | None,
    extra_read_roots: list[str] | tuple[str, ...] = (),
    list_roots: list[str] | tuple[str, ...] = (),
    abi: int | None = None,
) -> dict:
    """The JSON spec the launcher consumes.

    ``ro``: read + execute; ``rw``: the scratch directory; ``ls``: directory listing only (the
    import system lists the repo root to find the ``kernel`` package; file contents stay unreadable).
    """
    return {
        "abi": abi_version() if abi is None else abi,
        "ro": [*read_roots, *extra_read_roots],
        "rw": [scratch] if scratch else [],
        "ls": list(list_roots),
    }


def wrap_command(cmd: list[str], spec: dict) -> list[str]:
    """``cmd`` prefixed with the trusted launcher (run isolated, so the cwd/PYTHON* env cannot inject code)."""
    return [sys.executable, "-I", os.path.abspath(__file__), json.dumps(spec, separators=(",", ":")), "--", *cmd]


# ------------------------------------------------------------------ launcher half


class LandlockError(Exception):
    """Raised by the launcher when the ruleset cannot be built or applied."""


def _create_ruleset(libc, abi: int) -> int:
    # struct landlock_ruleset_attr { u64 handled_access_fs; u64 handled_access_net; u64 scoped; }
    # The kernel rejects a size larger than the ABI knows only when the extra bytes are non-zero,
    # but handled bits it does not know are EINVAL, so we mask by ABI and pass the matching size.
    net = (_NET_BIND_TCP | _NET_CONNECT_TCP) if abi >= 4 else 0
    scoped = (_SCOPE_ABSTRACT_UNIX | _SCOPE_SIGNAL) if abi >= 6 else 0
    fields = [handled_fs_access(abi)]
    if abi >= 4:
        fields.append(net)
    if abi >= 6:
        fields.append(scoped)
    attr = (ctypes.c_uint64 * len(fields))(*fields)
    fd = libc.syscall(_SYS_CREATE_RULESET, attr, ctypes.c_size_t(ctypes.sizeof(attr)), ctypes.c_uint32(0))
    if fd < 0:
        raise LandlockError(f"landlock_create_ruleset failed: {os.strerror(ctypes.get_errno())}")
    return int(fd)


class _PathBeneath(ctypes.Structure):
    _pack_ = 1
    _fields_ = (("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32))


def _add_path_rule(libc, ruleset_fd: int, path: str, rights: int, abi: int) -> bool:
    """Grant ``rights`` beneath ``path``; False when the path does not exist (skipped, never an error)."""
    try:
        fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    except OSError:
        return False
    try:
        if not os.path.isdir(path):
            rights &= _FS_FILE_RIGHTS  # directory-only rights on a file are EINVAL
        rights &= handled_fs_access(abi)
        rule = _PathBeneath(rights, fd)
        result = libc.syscall(_SYS_ADD_RULE, ruleset_fd, _RULE_PATH_BENEATH, ctypes.byref(rule), ctypes.c_uint32(0))
        if result < 0:
            raise LandlockError(f"landlock_add_rule({path}) failed: {os.strerror(ctypes.get_errno())}")
    finally:
        os.close(fd)
    return True


def apply_spec(spec: dict) -> None:
    """Build the ruleset from ``spec`` and restrict the calling process (irreversible)."""
    abi = int(spec.get("abi", 0))
    if abi < 1:
        raise LandlockError("Landlock is not available on this kernel")
    libc = _syscall()
    ruleset = _create_ruleset(libc, abi)
    try:
        for path in spec.get("ro", []):
            _add_path_rule(libc, ruleset, path, _ro_rights(abi), abi)
        for path in spec.get("rw", []):
            _add_path_rule(libc, ruleset, path, _scratch_rights(abi), abi)
        for path in spec.get("ls", []):
            _add_path_rule(libc, ruleset, path, _FS_READ_DIR, abi)
        for path, wants_write in _DEVICE_FILES:
            _add_path_rule(libc, ruleset, path, _FS_READ_FILE | (_FS_WRITE_FILE if wants_write else 0), abi)
        if libc.prctl(_PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            raise LandlockError(f"prctl(NO_NEW_PRIVS) failed: {os.strerror(ctypes.get_errno())}")
        if libc.syscall(_SYS_RESTRICT_SELF, ruleset, ctypes.c_uint32(0)) != 0:
            raise LandlockError(f"landlock_restrict_self failed: {os.strerror(ctypes.get_errno())}")
    finally:
        os.close(ruleset)


def main(argv: list[str]) -> int:
    """``landlock.py <spec-json> -- <cmd...>``: restrict, then exec; never returns on success."""
    if len(argv) < 4 or argv[2] != "--":
        sys.stderr.write("landlock: usage: landlock.py <spec-json> -- <command...>\n")
        return EXIT_LANDLOCK_FAILED
    try:
        apply_spec(json.loads(argv[1]))
    except (LandlockError, ValueError, OSError) as exc:
        sys.stderr.write(f"landlock: {exc}\n")
        return EXIT_LANDLOCK_FAILED
    command = argv[3:]
    try:
        os.execv(command[0], command)
    except OSError as exc:
        sys.stderr.write(f"landlock: cannot exec {command[0]}: {exc}\n")
        return EXIT_LANDLOCK_FAILED
    return 0  # pragma: no cover - execv does not return


if __name__ == "__main__":
    sys.exit(main(sys.argv))
