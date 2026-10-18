"""Run a worker subprocess with launch hygiene shared by sandbox and scorer.

``sys.executable -I`` (isolated mode), a minimal environment, a new session so
the whole process group can be killed, bounded wall time and cooperative
cancellation. Never raises: failures are reported in :class:`ProcResult`.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass

POLL_SECONDS = 0.05
STDERR_KEEP_BYTES = 4096


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


def kill_process_group(proc: subprocess.Popen) -> None:
    """SIGKILL the worker's whole process group (it leads its own session)."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except (ProcessLookupError, OSError):
            pass


def _kill_child(proc: subprocess.Popen) -> None:
    try:
        proc.kill()
    except (ProcessLookupError, OSError):
        pass


def python_command(script_path: str) -> list[str]:
    return [sys.executable, "-I", script_path]


def run_process(
    command: list[str],
    payload: bytes,
    *,
    wall_seconds: float,
    cancel_event: threading.Event | None = None,
    env: dict[str, str] | None = None,
    own_group: bool = True,
) -> ProcResult:
    """Run ``command`` feeding ``payload`` on stdin; kill it on timeout/cancel.

    ``own_group=True`` starts a new session and kills the whole process group.
    ``own_group=False`` keeps the child in the caller's group (so killing the
    caller's group also reaps it) and kills only the child itself.
    """
    if cancel_event is not None and cancel_event.is_set():
        return ProcResult(cancelled=True)
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

    box: dict[str, tuple[bytes, bytes]] = {}

    def _communicate() -> None:
        try:
            box["out"] = proc.communicate(input=payload)
        except (BrokenPipeError, OSError, ValueError):
            try:
                box["out"] = (proc.stdout.read() if proc.stdout else b"", b"")
            except (OSError, ValueError):
                box["out"] = (b"", b"")

    reader = threading.Thread(target=_communicate, daemon=True)
    reader.start()
    deadline = time.monotonic() + wall_seconds
    timed_out = cancelled = False
    while reader.is_alive():
        if cancel_event is not None and cancel_event.is_set():
            cancelled = True
            break
        if time.monotonic() >= deadline:
            timed_out = True
            break
        reader.join(POLL_SECONDS)
    kill = kill_process_group if own_group else _kill_child
    if timed_out or cancelled:
        kill(proc)
    reader.join(5)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        kill(proc)
    out, err = box.get("out", (b"", b""))
    return ProcResult(
        stdout=out or b"",
        stderr=(err or b"")[:STDERR_KEEP_BYTES],
        returncode=proc.returncode,
        timed_out=timed_out,
        cancelled=cancelled,
    )


def describe_signal(returncode: int | None) -> str:
    if returncode is None or returncode >= 0:
        return f"exit code {returncode}"
    try:
        return f"signal {signal.Signals(-returncode).name}"
    except ValueError:
        return f"signal {-returncode}"
