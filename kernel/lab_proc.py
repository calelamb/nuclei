"""Shared subprocess plumbing for the PRD 14 Lab job managers.

Home of the helpers that used to be duplicated between ``kernel/discovery/procrun.py`` and
``kernel/trainability/jobs.py`` (``minimal_env``, ``kill_process_group``) and of the job-manager machinery
that the trainability and conjecture managers share (:class:`LabJobManager`).

A job is one killable subprocess in its own process group.  One supervisor thread per job:

* reads the worker's stdout (JSON lines) on a reader thread with a *stop flag*, so a grandchild that keeps
  the pipe open can never block the terminal message;
* enforces the wall-clock limit;
* after the worker exits, gives the reader a short deadline to drain, then kills the process group,
  stops the reader and closes the pipes;
* always sends exactly one terminal message and releases the slot.
"""

from __future__ import annotations

import json
import logging
import os
import select
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator

from kernel import auth
from kernel.lab_context import LabContext

logger = logging.getLogger(__name__)

REPO_ROOT = str(Path(__file__).resolve().parents[1])

PINNED_ENV = {
    "OPENBLAS_NUM_THREADS": "1",
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "RAYON_NUM_THREADS": "1",
    "PYTHONHASHSEED": "0",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONNOUSERSITE": "1",
}
JOB_PASSTHROUGH_ENV = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT")
STRICT_PASSTHROUGH_ENV = ("PATH", "LANG")
STRICT_ENV_DEFAULTS = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}

#: Kernel authentication variables that must never reach a subprocess (see ``kernel.auth``).
KERNEL_SECRET_ENV = (auth.TOKEN_ENV, auth.INSECURE_ENV)

READ_POLL_SECONDS = 0.1
PIPE_DRAIN_GRACE_SECONDS = 2.0
STDERR_TAIL_LINES = 20
PARENT_POLL_SECONDS = 0.5
#: Trainability/conjecture workers: generous CPU cap (30 min), well above the 20-minute wall limit.
WORKER_CPU_SECONDS = 30 * 60


# ------------------------------------------------------------------ env / kill


def minimal_env(
    extra: dict[str, str] | None = None,
    *,
    passthrough: tuple[str, ...] = JOB_PASSTHROUGH_ENV,
    defaults: dict[str, str] | None = None,
) -> dict[str, str]:
    """A scrubbed environment: only ``passthrough`` variables, pinned thread counts, then ``extra``.

    ``defaults`` supplies values for passthrough variables the parent does not have
    (``STRICT_PASSTHROUGH_ENV`` + ``STRICT_ENV_DEFAULTS`` reproduce the candidate sandbox's environment).
    """
    env = {k: os.environ[k] for k in passthrough if k in os.environ}
    for key, value in (defaults or {}).items():
        env.setdefault(key, value)
    env.update(PINNED_ENV)
    env.update(extra or {})
    # Defence in depth: whatever the caller passes through, the kernel's session
    # token (and the dev-only auth override) never reach a worker or a candidate.
    for secret_name in KERNEL_SECRET_ENV:
        env.pop(secret_name, None)
    return env


def kill_process_group(proc: subprocess.Popen) -> None:
    """SIGKILL the worker's whole process group (it leads its own session); best effort."""
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGKILL)
        else:  # pragma: no cover - Windows
            proc.kill()
    except (ProcessLookupError, PermissionError):
        pass
    except OSError:
        try:
            proc.kill()
        except OSError:
            pass


# -------------------------------------------------------------- worker side


def apply_cpu_limit(seconds: int = WORKER_CPU_SECONDS) -> bool:
    """Cap this process's CPU time (soft limit kills with SIGXCPU); returns whether it took effect."""
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds + 10))
        return True
    except (ImportError, ValueError, OSError):
        return False


def start_parent_watch(
    interval: float = PARENT_POLL_SECONDS,
    exit_fn: Callable[[int], Any] = os._exit,
) -> threading.Thread | None:
    """Exit this (worker) process when its parent dies.

    Polls ``os.getppid()`` against the value at call time: when the kernel is SIGKILLed the worker is
    re-parented and would otherwise outlive it.  Call once, early, from the worker's ``main``.
    """
    if os.name != "posix":  # pragma: no cover - Windows has no reparenting
        return None
    original = os.getppid()

    def watch() -> None:
        while True:
            time.sleep(interval)
            if os.getppid() != original:
                exit_fn(1)
                return

    thread = threading.Thread(target=watch, name="lab-parent-watch", daemon=True)
    thread.start()
    return thread


# --------------------------------------------------------------- pipe reading


def iter_pipe_lines(pipe, stop: threading.Event) -> Iterator[str]:
    """Yield decoded lines from a binary pipe until EOF or ``stop`` is set.

    Uses ``select`` with a short timeout so a pipe that never reaches EOF (a grandchild holds the write
    end) cannot block the caller past ``stop``.
    """
    if os.name != "posix":  # pragma: no cover - Windows: blocking reads
        for raw in iter(pipe.readline, b""):
            yield raw.decode("utf-8", "replace").rstrip("\n")
        return
    fd = pipe.fileno()
    buffer = b""
    while not stop.is_set():
        try:
            ready, _, _ = select.select([fd], [], [], READ_POLL_SECONDS)
        except (OSError, ValueError):
            return
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            return
        if not chunk:
            break
        buffer += chunk
        *lines, buffer = buffer.split(b"\n")
        for raw in lines:
            yield raw.decode("utf-8", "replace")
    if buffer and not stop.is_set():
        yield buffer.decode("utf-8", "replace")


# --------------------------------------------------------------- job manager


@dataclass
class LabJob:
    """State shared by every job kind; subclasses add their request fields (all with defaults)."""

    job_id: str
    owner: int
    ctx: LabContext
    proc: subprocess.Popen | None = None
    started: float = field(default_factory=time.monotonic)
    cancelled: bool = False
    timed_out: bool = False
    #: The worker delivered its complete result; cancel/wall-limit can no longer override it.
    completed: bool = False
    #: The terminal message has been sent and the slot released.
    done: bool = False
    last_progress: float = 0.0
    malformed_lines: int = 0
    stderr_tail: deque = field(default_factory=lambda: deque(maxlen=STDERR_TAIL_LINES))


class LabJobManager:
    """Base class: slot accounting, spawn, supervise, cancel.  Subclasses fill in the protocol."""

    #: ``python -c`` bootstrap; ``sys.argv[1]`` is the repo root.
    BOOTSTRAP = ""
    NAME = "lab"
    ERROR_CLS: type[Exception] = RuntimeError
    BUSY_CODE = "busy"
    INTERNAL_CODE = "internal"
    DUPLICATE_CODE = "invalid_request"
    BUSY_MESSAGE = "Too many jobs are running. Wait for one to finish or cancel it."
    SPAWN_FAILED_MESSAGE = "Could not start the job worker"

    def __init__(
        self,
        *,
        wall_limit_s: float,
        max_per_owner: int,
        max_global: int,
        extra_env: dict[str, str] | None = None,
        extra_sys_path: list[str] | None = None,
        drain_grace_s: float = PIPE_DRAIN_GRACE_SECONDS,
    ) -> None:
        self.wall_limit_s = wall_limit_s
        self.max_per_owner = max_per_owner
        self.max_global = max_global
        self.drain_grace_s = drain_grace_s
        self._extra_env = dict(extra_env or {})
        self._extra_sys_path = list(extra_sys_path or [])
        self._lock = threading.Lock()
        self._jobs: dict[str, LabJob] = {}

    # ---- subclass hooks
    def _error(self, code: str, message: str) -> Exception:
        return self.ERROR_CLS(code, message)

    def _spec(self, job: LabJob) -> dict[str, Any]:
        raise NotImplementedError

    def _started_message(self, job: LabJob) -> dict[str, Any]:
        raise NotImplementedError

    def _handle_event(self, job: LabJob, event: dict[str, Any], emit) -> None:
        raise NotImplementedError

    def _terminal_message(self, job: LabJob) -> dict[str, Any]:
        raise NotImplementedError

    def _internal_failure(self, job: LabJob, exc: BaseException) -> dict[str, Any]:
        raise NotImplementedError

    # ---- queries
    def running(self, owner: int | None = None) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if owner is None or j.owner == owner)

    def pids(self, owner: int | None = None) -> list[int]:
        with self._lock:
            return [j.proc.pid for j in self._jobs.values() if j.proc and (owner is None or j.owner == owner)]

    # ---- start
    def _start_job(self, ctx: LabContext, job: LabJob) -> None:
        with self._lock:
            if job.job_id in self._jobs:
                raise self._error(self.DUPLICATE_CODE, f"Job '{job.job_id}' is already running.")
            mine = sum(1 for j in self._jobs.values() if j.owner == ctx.owner)
            if mine >= self.max_per_owner or len(self._jobs) >= self.max_global:
                raise self._error(self.BUSY_CODE, self.BUSY_MESSAGE)
            self._jobs[job.job_id] = job  # reserve the slot before spawning
        try:
            self._spawn(job)
        except Exception as exc:
            self._forget(job)
            raise self._error(self.INTERNAL_CODE, f"{self.SPAWN_FAILED_MESSAGE}: {exc}") from exc
        ctx.on_release(self._hook_key(job), lambda j=job: self._kill(j, cancelled=True))
        threading.Thread(target=self._supervise, args=(job,), name=f"{self.NAME}-{job.job_id}", daemon=True).start()

    def _spawn(self, job: LabJob) -> None:
        spec = {**self._spec(job), "sys_path": self._extra_sys_path}
        from kernel.trainability._jsonable import to_jsonable

        popen_kwargs: dict[str, Any] = {"start_new_session": True} if os.name == "posix" else {}
        proc = subprocess.Popen(
            [sys.executable, "-I", "-c", self.BOOTSTRAP, REPO_ROOT],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=minimal_env(self._extra_env), cwd=REPO_ROOT, **popen_kwargs,
        )
        job.proc = proc
        try:
            assert proc.stdin is not None
            proc.stdin.write((json.dumps(to_jsonable(spec)) + "\n").encode("utf-8"))
            proc.stdin.flush()
            proc.stdin.close()
        except OSError:
            pass  # worker died instantly; the supervisor reports it

    # ---- cancel
    def cancel(self, owner: int, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None or job.owner != owner or job.done or job.completed:
            return False
        self._kill(job, cancelled=True)
        return True

    def _kill(self, job: LabJob, *, cancelled: bool = False, timed_out: bool = False) -> None:
        if not job.completed:  # a delivered result is never overridden by a late cancel or timeout
            job.cancelled = job.cancelled or cancelled
            job.timed_out = job.timed_out or timed_out
        if job.proc is not None:
            kill_process_group(job.proc)

    def release_all(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            self._kill(job, cancelled=True)

    # ---- supervision
    def _supervise(self, job: LabJob) -> None:
        proc = job.proc
        assert proc is not None and proc.stdout is not None and proc.stderr is not None
        emit = job.ctx.emit_threadsafe
        stop = threading.Event()
        reader = threading.Thread(target=self._read_stdout, args=(job, stop, emit), daemon=True)
        err_reader = threading.Thread(target=self._read_stderr, args=(job, stop), daemon=True)
        try:
            emit(self._started_message(job))
            reader.start()
            err_reader.start()
            self._wait_for_exit(job)
            kill_process_group(proc)  # reap stragglers (grandchildren) of the normal exit too
            reader.join(self.drain_grace_s)
            err_reader.join(0.2)
        except Exception:  # noqa: BLE001 - the terminal message below must still go out
            logger.exception("%s job %s supervisor failed", self.NAME, job.job_id)
            kill_process_group(proc)
        finally:
            stop.set()
            reader.join(1.0)
            err_reader.join(1.0)
            for pipe in (proc.stdout, proc.stderr):
                try:
                    pipe.close()
                except Exception:  # noqa: BLE001
                    pass
            job.done = True
            self._finish(job, emit)

    def _wait_for_exit(self, job: LabJob) -> None:
        proc = job.proc
        assert proc is not None
        deadline = time.monotonic() + self.wall_limit_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._kill(job, timed_out=True)
                proc.wait()
                return
            try:
                proc.wait(timeout=min(0.25, remaining))
                return
            except subprocess.TimeoutExpired:
                continue

    def _read_stdout(self, job: LabJob, stop: threading.Event, emit) -> None:
        assert job.proc is not None and job.proc.stdout is not None
        for line in iter_pipe_lines(job.proc.stdout, stop):
            self._dispatch_line(job, line, emit)

    def _read_stderr(self, job: LabJob, stop: threading.Event) -> None:
        assert job.proc is not None and job.proc.stderr is not None
        for line in iter_pipe_lines(job.proc.stderr, stop):
            job.stderr_tail.append(line.rstrip())

    def _dispatch_line(self, job: LabJob, line: str, emit) -> None:
        """Parse and handle one protocol line; a bad line is skipped and reported, never fatal."""
        if not line.strip():
            return
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError("protocol line is not a JSON object")
            self._handle_event(job, event, emit)
        except Exception as exc:  # noqa: BLE001 - ValueError, KeyError, TypeError from a malformed event
            job.malformed_lines += 1
            note = f"[protocol] skipped malformed worker line ({type(exc).__name__}): {line.strip()[:80]}"
            logger.warning("%s job %s: %s", self.NAME, job.job_id, note)
            job.stderr_tail.append(note)

    _handle_line = _dispatch_line  # name kept for tests and subclass callers

    def _finish(self, job: LabJob, emit) -> None:
        self._forget(job)
        try:
            payload = self._terminal_message(job)
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s job %s: building the terminal message failed", self.NAME, job.job_id)
            payload = self._internal_failure(job, exc)
        emit(payload)

    def _forget(self, job: LabJob) -> None:
        with self._lock:
            self._jobs.pop(job.job_id, None)
        job.ctx.forget(self._hook_key(job))

    def _hook_key(self, job: LabJob) -> str:
        return f"{self.NAME}:{job.job_id}"

    @staticmethod
    def stderr_summary(job: LabJob, count: int = 3) -> str:
        return " | ".join(list(job.stderr_tail)[-count:])
