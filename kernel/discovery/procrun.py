"""Run a worker subprocess with launch hygiene shared by sandbox and scorer.

``sys.executable -I`` (isolated mode), a minimal environment, a new session so
the whole process group can be killed, bounded wall time and cooperative
cancellation. Never raises: failures are reported in :class:`ProcResult`.
"""

from __future__ import annotations

import os
import selectors
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass

POLL_SECONDS = 0.05
STDERR_KEEP_BYTES = 4096
STDERR_HARD_CAP_BYTES = 1 << 20
DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
DRAIN_SECONDS = 2.0
MEMORY_POLL_SECONDS = 0.25
DEFAULT_MEMORY_LIMIT_BYTES = 4 * 1024 ** 3
MEMORY_LIMIT_ENV = "NUCLEI_DISCOVERY_MAX_RSS_MB"
_UNSET: object = object()


def minimal_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "PYTHONNOUSERSITE": "1",
        "PYTHONHASHSEED": "0",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
        "RAYON_NUM_THREADS": "1",
    }
    if extra:
        env.update(extra)
    return env


@dataclass(frozen=True)
class ProcResult:
    stdout: bytes = b""
    stderr: bytes = b""
    returncode: int | None = None
    timed_out: bool = False
    cancelled: bool = False
    spawn_error: str | None = None
    output_overflow: bool = False
    memory_exceeded: bool = False


def kill_process_group(proc: subprocess.Popen) -> None:
    """SIGKILL the worker's whole process group (it leads its own session)."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except (ProcessLookupError, OSError):
            pass


def _kill_group_by_id(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _kill_child(proc: subprocess.Popen) -> None:
    try:
        proc.kill()
    except (ProcessLookupError, OSError):
        pass


def python_command(script_path: str) -> list[str]:
    return [sys.executable, "-I", script_path]


def memory_limit_bytes() -> int:
    """Configured RSS ceiling for one worker process group (``NUCLEI_DISCOVERY_MAX_RSS_MB``)."""
    raw = os.environ.get(MEMORY_LIMIT_ENV, "").strip()
    try:
        megabytes = int(raw)
    except ValueError:
        return DEFAULT_MEMORY_LIMIT_BYTES
    return megabytes * 1024 * 1024 if megabytes > 0 else DEFAULT_MEMORY_LIMIT_BYTES


def group_rss_bytes(pgid: int) -> int:
    """Total resident set size (bytes) of every process in ``pgid``; 0 if unknown.

    ``ps`` is used because ``resource.getrusage`` cannot see running children and RLIMIT_AS
    is not enforceable on macOS. One short ``ps`` call every ``MEMORY_POLL_SECONDS``.
    """
    try:
        out = subprocess.run(
            ["ps", "-ax", "-o", "pgid=,rss="], capture_output=True, text=True, timeout=5, check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return 0
    total_kib = 0
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] == str(pgid) and parts[1].isdigit():
            total_kib += int(parts[1])
    return total_kib * 1024


class _Collector:
    """Bounded stdout/stderr accumulation shared by the select loop."""

    def __init__(self, max_output: int):
        self.max_output = max_output
        self.out = bytearray()
        self.err = bytearray()
        self.err_total = 0
        self.overflow = False

    def feed(self, kind: str, chunk: bytes) -> None:
        if kind == "out":
            room = self.max_output + 1 - len(self.out)
            self.out.extend(chunk[:max(room, 0)])
            if len(self.out) > self.max_output:
                self.overflow = True
            return
        self.err_total += len(chunk)
        room = STDERR_KEEP_BYTES - len(self.err)
        if room > 0:
            self.err.extend(chunk[:room])
        if self.err_total > STDERR_HARD_CAP_BYTES:
            self.overflow = True


def _pump_once(sel: selectors.BaseSelector, collector: _Collector, stdin_state: dict, timeout: float) -> None:
    for key, _events in sel.select(timeout):
        kind = key.data
        if kind == "in":
            view = stdin_state["view"]
            try:
                written = os.write(key.fd, view[:65536])
                stdin_state["view"] = view[written:]
            except BlockingIOError:
                continue
            except OSError:
                stdin_state["view"] = b""
            if not stdin_state["view"]:
                sel.unregister(key.fileobj)
                key.fileobj.close()
            continue
        try:
            chunk = os.read(key.fd, 65536)
        except BlockingIOError:
            continue
        except OSError:
            chunk = b""
        if chunk:
            collector.feed(kind, chunk)
        else:
            sel.unregister(key.fileobj)


def run_process(
    command: list[str],
    payload: bytes,
    *,
    wall_seconds: float,
    cancel_event: threading.Event | None = None,
    env: dict[str, str] | None = None,
    own_group: bool = True,
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES,
    memory_limit: int | None | object = _UNSET,
) -> ProcResult:
    """Run ``command`` feeding ``payload`` on stdin; kill it on timeout/cancel/flood/memory.

    ``own_group=True`` starts a new session and kills the whole process group, and does so
    after EVERY exit (not only on timeout) so no descendant outlives the worker.
    ``own_group=False`` keeps the child in the caller's group (so killing the
    caller's group also reaps it) and kills only the child itself.

    Output is read with a bounded ``select`` loop in the calling thread (no reader thread to
    abandon): stdout beyond ``max_output_bytes`` kills the group at cap + 1 byte.
    ``memory_limit`` is a group-RSS ceiling in bytes (default from the environment, 4 GiB;
    ``None`` disables it).
    """
    if cancel_event is not None and cancel_event.is_set():
        return ProcResult(cancelled=True)
    limit = memory_limit_bytes() if memory_limit is _UNSET else memory_limit
    try:
        proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env if env is not None else minimal_env(),
            start_new_session=own_group,
        )
    except OSError as exc:
        return ProcResult(spawn_error=f"{type(exc).__name__}: {exc}")

    pgid = proc.pid if own_group else None

    def kill(target: subprocess.Popen) -> None:
        # By group id, not getpgid(pid): after the leader is reaped getpgid fails.
        if pgid is not None:
            _kill_group_by_id(pgid)
        else:
            _kill_child(target)

    collector = _Collector(max_output_bytes)
    stdin_state = {"view": memoryview(payload)}
    sel = selectors.DefaultSelector()
    for fobj, kind in ((proc.stdout, "out"), (proc.stderr, "err")):
        os.set_blocking(fobj.fileno(), False)
        sel.register(fobj, selectors.EVENT_READ, kind)
    os.set_blocking(proc.stdin.fileno(), False)
    if payload:
        sel.register(proc.stdin, selectors.EVENT_WRITE, "in")
    else:
        proc.stdin.close()

    deadline = time.monotonic() + wall_seconds
    next_memory_check = time.monotonic() + MEMORY_POLL_SECONDS
    timed_out = cancelled = memory_exceeded = False
    exited_at: float | None = None
    try:
        while sel.get_map():
            now = time.monotonic()
            if cancel_event is not None and cancel_event.is_set():
                cancelled = True
                break
            if now >= deadline:
                timed_out = True
                break
            if collector.overflow:
                break
            if limit and pgid is not None and now >= next_memory_check:
                next_memory_check = now + MEMORY_POLL_SECONDS
                if group_rss_bytes(pgid) > limit:
                    memory_exceeded = True
                    break
            if proc.poll() is not None:
                # The worker is gone: reap its whole group now so a descendant holding
                # the pipes cannot keep this loop (or the machine) busy.
                if exited_at is None:
                    exited_at = now
                    kill(proc)
                elif now - exited_at > DRAIN_SECONDS:
                    break
            _pump_once(sel, collector, stdin_state, POLL_SECONDS)
    finally:
        # Always kill the group, even after a clean exit, and bound everything after.
        kill(proc)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            kill(proc)
        sel.close()
        for fobj in (proc.stdin, proc.stdout, proc.stderr):
            try:
                if fobj is not None:
                    fobj.close()
            except OSError:
                pass
    return ProcResult(
        stdout=bytes(collector.out),
        stderr=bytes(collector.err),
        returncode=proc.returncode,
        timed_out=timed_out,
        cancelled=cancelled,
        output_overflow=collector.overflow,
        memory_exceeded=memory_exceeded,
    )


def describe_signal(returncode: int | None) -> str:
    if returncode is None or returncode >= 0:
        return f"exit code {returncode}"
    try:
        return f"signal {signal.Signals(-returncode).name}"
    except ValueError:
        return f"signal {-returncode}"
