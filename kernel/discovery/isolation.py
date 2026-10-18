"""Opportunistic OS-level isolation for the candidate sandbox (spec 4.1.7).

The baseline is always a subprocess with rlimits and an import blocker
(``"process"``). When the platform offers more, the worker command is wrapped:

* Linux: ``bwrap --unshare-net --unshare-pid --die-with-parent`` with read-only
  binds of ONLY the interpreter prefixes, site-packages, the repo's ``kernel/``
  tree and the system library directories (no ``/home``, no ``/etc``), and a
  private ``/tmp``.
* macOS: ``sandbox-exec`` with deny-network, deny-file-write AND deny-file-read
  (an explicit read allow-list: interpreter prefixes, site-packages, the repo's
  ``kernel/`` tree, system libraries and the dyld cache). The only writable
  location is the per-evaluation private scratch directory (mode 0700,
  referenced by its realpath, deleted after the run), which also hosts
  ``TMPDIR``, ``MPLCONFIGDIR`` and ``HOME`` so Cirq/matplotlib/Qiskit can import.

A wrapper is only used after a *runtime* probe has run the real candidate
worker through it successfully, and it is demoted (with a recorded reason) if a
later run shows it failing. The reported mode is never stronger than what ran.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable, Iterator

from kernel.discovery.constants import ISOLATION_ENV
from kernel.discovery.procrun import minimal_env, python_command, run_process

MODE_PROCESS = "process"
MODE_BWRAP = "bwrap"
MODE_SANDBOX_EXEC = "sandbox-exec"
READS_RESTRICTED = "restricted"
READS_UNRESTRICTED = "unrestricted"
PROBE_WALL_SECONDS = 30

# Static part of the macOS profile. Reads are DENIED by default (RT-H2); the allow-list
# below is the empirically minimal set a Python + numpy/stim/qiskit/cirq worker needs.
# ``file-read-metadata`` (stat/realpath traversal) stays open: it reveals that a path
# exists, never its contents.
_MAC_STATIC_PROFILE = (
    "(version 1)\n"
    "(allow default)\n"
    "(deny network*)\n"
    "(deny file-write*)\n"
    '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))\n'
    "(deny file-read*)\n"
    "(allow file-read-metadata)\n"
    '(allow file-read* (literal "/") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")'
    ' (literal "/dev/dtracehelper") (literal "/dev/zero"))\n'
    "(allow file-read* {system_roots})\n"
)
# Empirically (Darwin 25.5, python.org 3.12 framework build + venv, numpy/stim/qiskit/cirq) the
# dyld shared cache needs NO file-read grant at all; these system roots are kept as
# belt-and-braces for macOS versions that load libraries from disk. They hold system files
# only: nothing under /Users, /private/var/folders, /Volumes or the repo.
_MAC_SYSTEM_READ_ROOTS = (
    "/usr/lib",
    "/usr/share/zoneinfo",
    "/System/Library",
    "/System/Volumes/Preboot/Cryptexes",
    "/private/var/db/dyld",
    "/private/etc/localtime",
)
# Appended only when a scratch directory exists; ``SCRATCH`` is passed with ``-D`` as a realpath.
_MAC_SCRATCH_RULE = '(allow file-write* (subpath (param "SCRATCH")))\n(allow file-read* (subpath (param "SCRATCH")))\n'

_PROBE_REQUEST = {
    "protocol_version": 1,
    "task": "stim_circuit",
    "program": "import stim\ndef build():\n    return stim.Circuit('H 0')\n",
    "entry": "build",
    "calls": [{"args": [], "kwargs": {}}],
    "cpu_seconds": 20,
}


@dataclass(frozen=True)
class IsolationInfo:
    mode: str
    wrap: Callable[[list[str]], list[str]] = field(compare=False, default=lambda cmd: cmd)
    note: str = ""
    scratch_aware: bool = field(compare=False, default=False)
    # "restricted": the wrapper denies file reads outside an allow-list; "unrestricted": the
    # worker can read anything its user can (plain process mode). Never stronger than what ran.
    reads: str = field(compare=False, default=READS_UNRESTRICTED)

    @property
    def detail(self) -> dict[str, str]:
        return {"reads": self.reads}

    def command(self, cmd: list[str], scratch: str | None = None) -> list[str]:
        """Wrap ``cmd``; scratch-aware wrappers also open ``scratch`` for writing."""
        if self.scratch_aware and scratch is not None:
            return self.wrap(cmd, scratch)  # type: ignore[call-arg]
        return self.wrap(cmd)


_PROCESS = IsolationInfo(MODE_PROCESS, note="subprocess + rlimits + import blocker")
_lock = threading.Lock()
_cached: IsolationInfo | None = None


def _real(path: str) -> str:
    return os.path.realpath(path)


def python_read_roots() -> list[str]:
    """Directories the worker interpreter must read: prefixes, site-packages and ``kernel/``.

    Realpaths, deduplicated, existing only. ``kernel/`` (not the whole repo) is granted
    because the worker imports ``kernel.*``; the repo root itself is added by callers
    as a directory-listing-only literal where the platform needs it.
    """
    candidates = [sys.prefix, sys.exec_prefix, sys.base_prefix, sys.base_exec_prefix, os.path.dirname(sys.executable)]
    try:
        import site

        candidates.extend(site.getsitepackages())
    except Exception:  # noqa: BLE001 - virtualenv's site lacks getsitepackages on old versions
        pass
    candidates.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # .../kernel
    # Editable installs / .pth entries that live outside the prefixes.
    candidates.extend(p for p in sys.path if p and os.path.isabs(p) and os.path.basename(p) in ("site-packages", "dist-packages"))
    seen: list[str] = []
    for path in candidates:
        real = _real(path)
        if os.path.isdir(real) and real not in seen:
            seen.append(real)
    return seen


def repo_root() -> str:
    return _real(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def _bwrap_wrap(cmd: list[str], scratch: str | None = None, roots: list[str] | None = None) -> list[str]:
    """``bwrap`` argv that binds ONLY what the worker needs, read-only (RT-H2, Linux).

    The host root is no longer mounted: the worker sees the system library dirs, the
    interpreter prefixes, site-packages and ``kernel/`` (read-only), a private ``/tmp``
    and, when given, its writable per-evaluation ``scratch`` directory.
    """
    argv = ["bwrap", "--unshare-net", "--unshare-pid", "--die-with-parent"]
    for system in _LINUX_SYSTEM_RO:
        argv += ["--ro-bind-try", system, system]
    for root in roots if roots is not None else python_read_roots():
        argv += ["--ro-bind", root, root]
    argv += ["--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"]
    if scratch is not None:
        argv += ["--bind", scratch, scratch]
    return [*argv, *cmd]


_bwrap_wrap.scratch_aware = True  # type: ignore[attr-defined]

# System directories the dynamic loader, libc and the zoneinfo/locale lookups need.
_LINUX_SYSTEM_RO = ("/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/localtime")


def mac_profile(scratch: str | None, roots: list[str]) -> tuple[str, list[str]]:
    """Return (profile text, ``-D`` params) for the macOS sandbox."""
    system = " ".join(f'(subpath "{p}")' for p in _MAC_SYSTEM_READ_ROOTS)
    profile = _MAC_STATIC_PROFILE.format(system_roots=system)
    params: list[str] = []
    for index, root in enumerate(roots):
        profile += f'(allow file-read* (subpath (param "READ{index}")))\n'
        params += ["-D", f"READ{index}={root}"]
    # The import system lists the repo root to find the ``kernel`` package (names only).
    profile += '(allow file-read* (literal (param "REPO")))\n'
    params += ["-D", f"REPO={repo_root()}"]
    if scratch is not None:
        profile += _MAC_SCRATCH_RULE
        params += ["-D", f"SCRATCH={scratch}"]
    return profile, params


def _sandbox_exec_wrap(cmd: list[str], scratch: str | None = None, roots: list[str] | None = None) -> list[str]:
    profile, params = mac_profile(scratch, roots if roots is not None else python_read_roots())
    return ["sandbox-exec", *params, "-p", profile, *cmd]


_sandbox_exec_wrap.scratch_aware = True  # type: ignore[attr-defined]


@contextmanager
def private_scratch_dir() -> Iterator[str]:
    """A fresh 0700 directory (realpath, since the macOS profile matches real paths), removed on exit."""
    path = os.path.realpath(tempfile.mkdtemp(prefix="nuclei-cand-"))
    try:
        os.chmod(path, 0o700)
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def scratch_env(scratch: str) -> dict[str, str]:
    """Environment entries that redirect temp and matplotlib cache writes into ``scratch``."""
    return {"TMPDIR": scratch, "MPLCONFIGDIR": scratch, "HOME": scratch}


def _candidate_modes() -> list[tuple[str, Callable[[list[str]], list[str]]]]:
    if sys.platform.startswith("linux") and shutil.which("bwrap"):
        return [(MODE_BWRAP, _bwrap_wrap)]
    if sys.platform == "darwin" and shutil.which("sandbox-exec"):
        return [(MODE_SANDBOX_EXEC, _sandbox_exec_wrap)]
    return []


def _worker_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "candidate_worker.py")


def probe_wrapper(wrap: Callable[[list[str]], list[str]]) -> tuple[bool, str]:
    """Run the real worker through ``wrap``; True only on a clean ok response."""
    payload = json.dumps(_PROBE_REQUEST).encode()
    with private_scratch_dir() as scratch:
        info = IsolationInfo("probe", wrap, scratch_aware=getattr(wrap, "scratch_aware", False))
        command = info.command(python_command(_worker_path()), scratch)
        result = run_process(
            command, payload, wall_seconds=PROBE_WALL_SECONDS, env=minimal_env(scratch_env(scratch))
        )
    if result.spawn_error:
        return False, result.spawn_error
    try:
        response = json.loads(result.stdout.decode("utf-8").strip().splitlines()[-1])
    except (ValueError, IndexError, UnicodeDecodeError):
        tail = result.stderr.decode("utf-8", "replace").strip()[:200]
        return False, f"worker produced no valid response under the wrapper: {tail}"
    if response.get("status") != "ok":
        return False, f"worker reported {response.get('error')}"
    return True, "probe passed"


def detect_isolation(*, refresh: bool = False) -> IsolationInfo:
    """Return the strongest verified isolation (cached). Honors NUCLEI_DISCOVERY_ISOLATION=process."""
    global _cached
    with _lock:
        if _cached is not None and not refresh:
            return _cached
        if os.environ.get(ISOLATION_ENV, "").strip().lower() == MODE_PROCESS:
            _cached = IsolationInfo(MODE_PROCESS, note="forced by environment")
            return _cached
        info = _PROCESS
        for mode, wrap in _candidate_modes():
            ok, detail = probe_wrapper(wrap)
            if ok:
                info = IsolationInfo(
                    mode, wrap, detail, scratch_aware=getattr(wrap, "scratch_aware", False), reads=READS_RESTRICTED,
                )
                break
            info = IsolationInfo(MODE_PROCESS, note=f"{mode} unavailable at runtime: {detail}")
        _cached = info
        return _cached


def demote(info: IsolationInfo, reason: str) -> IsolationInfo:
    """Record that ``info`` failed at runtime and fall back to plain process mode."""
    global _cached
    with _lock:
        _cached = IsolationInfo(MODE_PROCESS, note=f"{info.mode} demoted: {reason}")
        return _cached


def reset_for_tests() -> None:
    global _cached
    with _lock:
        _cached = None
