"""Opportunistic OS-level isolation for the candidate sandbox (spec 4.1.7).

The baseline is always a subprocess with rlimits and an import blocker
(``"process"``). When the platform offers more, the worker command is wrapped:

* Linux: ``bwrap --unshare-net --unshare-pid --die-with-parent`` with read-only
  binds of ONLY the interpreter prefixes, site-packages, the repo's ``kernel/``
  tree and the system library directories (no ``/home``, no ``/etc``), and a
  private ``/tmp``.
* Linux without usable user namespaces (Ubuntu 24.04 sets
  ``kernel.apparmor_restrict_unprivileged_userns=1``, which blocks ``bwrap``): the
  ``landlock`` tier. A trusted launcher (``landlock.py``) restricts itself with an
  unprivileged Landlock ruleset (read-only interpreter/venv, ``kernel/``, system libs;
  read-write scratch only; TCP connect/bind denied on ABI >= 4) and then replaces
  itself (``exec``) with the worker. What it really enforces is *observed* by a probe, not assumed.
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
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable, Iterator

from kernel.discovery import landlock
from kernel.discovery._optional import is_importable
from kernel.discovery.constants import ISOLATION_ENV
from kernel.discovery.procrun import minimal_env, python_command, run_process

MODE_PROCESS = "process"
MODE_BWRAP = "bwrap"
MODE_SANDBOX_EXEC = "sandbox-exec"
MODE_LANDLOCK = "landlock"
READS_RESTRICTED = "restricted"
READS_UNRESTRICTED = "unrestricted"
WRITES_SCRATCH_ONLY = "scratch-only"
WRITES_UNRESTRICTED = "unrestricted"
NETWORK_DENIED = "denied"
NETWORK_UNRESTRICTED = "unrestricted"
PROBE_WALL_SECONDS = 30
BWRAP_PROBE_SECONDS = 10
USERNS_SYSCTL = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns"

# Shown to the user (and echoed in ``isolation_consent_required``) before candidate code may run
# without an OS sandbox. Exact wording is part of the contract: the consent dialog renders it.
PROCESS_CAPABILITY_TEXT = (
    "This computer cannot sandbox candidate code (no landlock, bwrap or sandbox-exec). "
    "Candidate programs will run as your own user account: they can read, modify and delete any file "
    "you can, and can use your network. A static check blocks the obvious file-deleting calls, but it "
    "is not a security boundary."
)

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

# Used when Stim (an optional Research-catalog package) is absent, so the probe still verifies
# the sandbox with a framework that the managed venv always ships.
_QISKIT_PROBE_REQUEST = {
    **_PROBE_REQUEST,
    "task": "quantum_circuit",
    "program": "from qiskit import QuantumCircuit\ndef build():\n    qc = QuantumCircuit(1)\n    qc.h(0)\n    return qc\n",
}


def probe_request() -> dict:
    """The probe program: Stim when installed, otherwise Qiskit (never a package the venv may lack)."""
    return _PROBE_REQUEST if is_importable("stim") else _QISKIT_PROBE_REQUEST


@dataclass(frozen=True)
class IsolationInfo:
    mode: str
    wrap: Callable[[list[str]], list[str]] = field(compare=False, default=lambda cmd: cmd)
    note: str = ""
    scratch_aware: bool = field(compare=False, default=False)
    # "restricted": the wrapper denies file reads outside an allow-list; "unrestricted": the
    # worker can read anything its user can (plain process mode). Never stronger than what ran.
    reads: str = field(compare=False, default=READS_UNRESTRICTED)
    writes: str = field(compare=False, default=WRITES_UNRESTRICTED)
    network: str = field(compare=False, default=NETWORK_UNRESTRICTED)
    # The operator forced plain process mode on purpose (NUCLEI_DISCOVERY_ISOLATION=process),
    # so there is nobody to ask for consent.
    consent_exempt: bool = field(compare=False, default=False)

    @property
    def detail(self) -> dict[str, str]:
        return {"reads": self.reads, "writes": self.writes, "network": self.network}

    @property
    def needs_consent(self) -> bool:
        """True when candidates would run with the user's full file access and no OS sandbox."""
        return self.mode == MODE_PROCESS and not self.consent_exempt

    def command(self, cmd: list[str], scratch: str | None = None, extra_read_roots: tuple[str, ...] = ()) -> list[str]:
        """Wrap ``cmd``; scratch-aware wrappers also open ``scratch`` for writing.

        ``extra_read_roots`` (for example the project root) are made readable, never writable,
        where the tier can grant that.
        """
        if self.scratch_aware and scratch is not None:
            if extra_read_roots:
                return self.wrap(cmd, scratch, extra_ro=tuple(extra_read_roots))  # type: ignore[call-arg]
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


def _bwrap_wrap(
    cmd: list[str], scratch: str | None = None, roots: list[str] | None = None, extra_ro: tuple[str, ...] = (),
) -> list[str]:
    """``bwrap`` argv that binds ONLY what the worker needs, read-only (RT-H2, Linux).

    The host root is no longer mounted: the worker sees the system library dirs, the
    interpreter prefixes, site-packages and ``kernel/`` (read-only), a private ``/tmp``
    and, when given, its writable per-evaluation ``scratch`` directory.
    """
    argv = ["bwrap", "--unshare-net", "--unshare-pid", "--die-with-parent"]
    for system in _LINUX_SYSTEM_RO:
        argv += ["--ro-bind-try", system, system]
    for root in [*(roots if roots is not None else python_read_roots()), *_existing_dirs(extra_ro)]:
        argv += ["--ro-bind", root, root]
    argv += ["--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"]
    if scratch is not None:
        argv += ["--bind", scratch, scratch]
    return [*argv, *cmd]


_bwrap_wrap.scratch_aware = True  # type: ignore[attr-defined]

# System directories the dynamic loader, libc and the zoneinfo/locale lookups need.
_LINUX_SYSTEM_RO = ("/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/localtime")


def _existing_dirs(paths: tuple[str, ...]) -> list[str]:
    """Realpaths of the existing directories among ``paths`` (deduplicated, order kept)."""
    out: list[str] = []
    for path in paths:
        real = _real(path)
        if os.path.isdir(real) and real not in out:
            out.append(real)
    return out


def _landlock_wrap(
    cmd: list[str], scratch: str | None = None, roots: list[str] | None = None, extra_ro: tuple[str, ...] = (),
) -> list[str]:
    """Prefix ``cmd`` with the Landlock launcher: read-only roots, writable scratch, no TCP (ABI >= 4)."""
    read_roots = [*_LINUX_SYSTEM_RO, *(roots if roots is not None else python_read_roots())]
    spec = landlock.build_spec(read_roots, scratch, _existing_dirs(extra_ro), [repo_root()])
    return landlock.wrap_command(cmd, spec)


_landlock_wrap.scratch_aware = True  # type: ignore[attr-defined]


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


def _sandbox_exec_wrap(
    cmd: list[str], scratch: str | None = None, roots: list[str] | None = None, extra_ro: tuple[str, ...] = (),
) -> list[str]:
    base = roots if roots is not None else python_read_roots()
    profile, params = mac_profile(scratch, [*base, *_existing_dirs(extra_ro)])
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


# Why a stronger tier was skipped during the last detection (shown in the process-mode note).
_skip_notes: list[str] = []


def userns_probe() -> tuple[bool, str]:
    """Can ``bwrap`` create the user namespace it needs? ``(False, reason)`` on Ubuntu 24.04 defaults.

    ``bwrap --ro-bind / / true`` is the smallest command that needs the namespace; the AppArmor
    sysctl is consulted only to give the reason a name.
    """
    try:
        done = subprocess.run(
            ["bwrap", "--ro-bind", "/", "/", "true"], capture_output=True, timeout=BWRAP_PROBE_SECONDS,
            env=minimal_env(), check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"bwrap could not be started: {type(exc).__name__}: {exc}"
    if done.returncode == 0:
        return True, "user namespaces available"
    reason = done.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or ["unknown error"]
    try:
        with open(USERNS_SYSCTL, encoding="ascii") as handle:
            if handle.read().strip() == "1":
                return False, f"{reason[0]} (kernel.apparmor_restrict_unprivileged_userns=1 blocks unprivileged bwrap)"
    except OSError:
        pass
    return False, reason[0]


def _linux_modes() -> list[tuple[str, Callable[[list[str]], list[str]]]]:
    modes: list[tuple[str, Callable[[list[str]], list[str]]]] = []
    if shutil.which("bwrap"):
        usable, why = userns_probe()
        if usable:
            modes.append((MODE_BWRAP, _bwrap_wrap))
        else:
            _skip_notes.append(f"bwrap unavailable: {why}")
    abi = landlock.abi_version()
    if abi >= 1:
        modes.append((MODE_LANDLOCK, _landlock_wrap))
    else:
        _skip_notes.append("landlock unavailable: kernel lacks Landlock or it is disabled")
    return modes


def _candidate_modes() -> list[tuple[str, Callable[[list[str]], list[str]]]]:
    """Wrapper tiers to try, strongest first (the first one whose probe passes wins)."""
    if sys.platform.startswith("linux"):
        return _linux_modes()
    if sys.platform == "darwin" and shutil.which("sandbox-exec"):
        return [(MODE_SANDBOX_EXEC, _sandbox_exec_wrap)]
    return []


def _worker_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "candidate_worker.py")


def probe_wrapper(wrap: Callable[[list[str]], list[str]]) -> tuple[bool, str]:
    """Run the real worker through ``wrap``; True only on a clean ok response."""
    payload = json.dumps(probe_request()).encode()
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


_OBSERVE_SCRIPT = r"""
import json, os, socket, sys
canary, scratch = sys.argv[1], sys.argv[2]
def attempt(fn):
    try:
        fn()
        return "ok"
    except PermissionError:
        return "denied"
    except OSError:
        return "error"
def write(path):
    with open(path, "w") as handle:
        handle.write("x")
def read(path):
    with open(path) as handle:
        handle.read()
print(json.dumps({
    "read_outside": attempt(lambda: read(os.path.join(canary, "secret.txt"))),
    "write_outside": attempt(lambda: write(os.path.join(canary, "new.txt"))),
    "write_scratch": attempt(lambda: write(os.path.join(scratch, "probe.txt"))),
    "connect": attempt(lambda: socket.create_connection(("127.0.0.1", 1), timeout=2).close()),
}))
"""


def observe_confinement(wrap: Callable[[list[str]], list[str]]) -> dict[str, str] | None:
    """Run a tiny script through ``wrap`` and report what is *actually* denied (reads/writes/network).

    ``None`` when the observation itself failed or scratch was not writable (the wrapper is unusable).
    A canary directory outside every granted root is the read/write target; if the system temp dir
    happens to sit under a granted root the read/write claims fall back to ``unrestricted``.
    """
    roots = python_read_roots() + [*_LINUX_SYSTEM_RO]
    with private_scratch_dir() as scratch:
        canary = _real(tempfile.mkdtemp(prefix="nuclei-canary-"))
        try:
            with open(os.path.join(canary, "secret.txt"), "w", encoding="ascii") as handle:
                handle.write("canary")
            comparable = not any(canary == r or canary.startswith(r.rstrip(os.sep) + os.sep) for r in map(_real, roots))
            info = IsolationInfo("probe", wrap, scratch_aware=getattr(wrap, "scratch_aware", False))
            command = info.command([sys.executable, "-I", "-c", _OBSERVE_SCRIPT, canary, scratch], scratch)
            result = run_process(command, b"", wall_seconds=PROBE_WALL_SECONDS, env=minimal_env(scratch_env(scratch)))
            try:
                seen = json.loads(result.stdout.decode("utf-8").strip().splitlines()[-1])
            except (ValueError, IndexError, UnicodeDecodeError):
                return None
        finally:
            shutil.rmtree(canary, ignore_errors=True)
    if seen.get("write_scratch") != "ok":
        return None
    contained = comparable and seen.get("read_outside") == "denied"
    return {
        "reads": READS_RESTRICTED if contained else READS_UNRESTRICTED,
        "writes": WRITES_SCRATCH_ONLY if comparable and seen.get("write_outside") == "denied" else WRITES_UNRESTRICTED,
        "network": NETWORK_DENIED if seen.get("connect") == "denied" else NETWORK_UNRESTRICTED,
    }


def _verified_info(mode: str, wrap: Callable[[list[str]], list[str]], detail: str) -> tuple[IsolationInfo | None, str]:
    """Build the tier's info after a passed worker probe; Landlock's claims come from observation."""
    scratch_aware = getattr(wrap, "scratch_aware", False)
    if mode != MODE_LANDLOCK:
        return IsolationInfo(
            mode, wrap, detail, scratch_aware=scratch_aware, reads=READS_RESTRICTED,
            writes=WRITES_SCRATCH_ONLY, network=NETWORK_DENIED,
        ), ""
    observed = observe_confinement(wrap)
    if observed is None:
        return None, "the confinement probe did not run"
    if observed["writes"] != WRITES_SCRATCH_ONLY:
        return None, "denial of writes outside scratch could not be demonstrated"
    note = f"{detail} (landlock ABI {landlock.abi_version()})"
    return IsolationInfo(
        mode, wrap, note, scratch_aware=scratch_aware, reads=observed["reads"], writes=observed["writes"],
        network=observed["network"],
    ), ""


def detect_isolation(*, refresh: bool = False) -> IsolationInfo:
    """Return the strongest verified isolation (cached). Honors NUCLEI_DISCOVERY_ISOLATION=process."""
    global _cached
    with _lock:
        if _cached is not None and not refresh:
            return _cached
        if os.environ.get(ISOLATION_ENV, "").strip().lower() == MODE_PROCESS:
            _cached = IsolationInfo(MODE_PROCESS, note="forced by environment", consent_exempt=True)
            return _cached
        _skip_notes.clear()
        notes: list[str] = []
        info = _PROCESS
        for mode, wrap in _candidate_modes():
            ok, detail = probe_wrapper(wrap)
            verified, problem = _verified_info(mode, wrap, detail) if ok else (None, detail)
            if verified is not None:
                info = verified
                break
            notes.append(f"{mode} unavailable at runtime: {problem}")
        else:
            info = IsolationInfo(MODE_PROCESS, note="; ".join([*notes, *_skip_notes]) or _PROCESS.note)
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
