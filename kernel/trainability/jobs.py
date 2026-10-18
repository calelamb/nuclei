"""Trainability job manager: one killable subprocess per job.

Each job runs :mod:`kernel.trainability.job_worker` in its own process group
(``sys.executable -I`` with a minimal explicit environment).  The worker
streams JSON lines; a reader thread turns them into protocol messages.  The
process group is killed on cancel, on owner release (connection close) and at
the wall-clock limit.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kernel.lab_context import LabContext
from kernel.trainability._errors import TrainabilityError
from kernel.trainability._jsonable import to_jsonable
from kernel.trainability.provenance import build_provenance

MAX_JOBS_PER_OWNER = 2
MAX_JOBS_GLOBAL = 4
WALL_LIMIT_SECONDS = 20 * 60
PROGRESS_MIN_INTERVAL = 0.1  # <= 10 progress messages per second per job
STDERR_TAIL_LINES = 20
_REPO_ROOT = str(Path(__file__).resolve().parents[2])
_BOOTSTRAP = (
    "import sys; sys.path.insert(0, sys.argv[1]); "
    "from kernel.trainability.job_worker import main; raise SystemExit(main())"
)
_PINNED_ENV = {
    "OPENBLAS_NUM_THREADS": "1",
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "RAYON_NUM_THREADS": "1",
    "PYTHONHASHSEED": "0",
    "PYTHONDONTWRITEBYTECODE": "1",
}
_PASSTHROUGH_ENV = ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT")


def minimal_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {k: os.environ[k] for k in _PASSTHROUGH_ENV if k in os.environ}
    env.update(_PINNED_ENV)
    env.update(extra or {})
    return env


def kill_process_group(proc: subprocess.Popen) -> None:
    """SIGKILL the job's whole process group (best effort)."""
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


@dataclass
class _Job:
    job_id: str
    owner: int
    ctx: LabContext
    request: dict[str, Any]
    proc: subprocess.Popen | None = None
    started: float = field(default_factory=time.monotonic)
    cancelled: bool = False
    timed_out: bool = False
    prepared: dict[str, Any] | None = None
    results: dict[str, Any] = field(default_factory=dict)
    errors: dict[str, dict[str, Any]] = field(default_factory=dict)
    fatal: dict[str, Any] | None = None
    done: bool = False
    last_progress: float = 0.0
    stderr_tail: deque = field(default_factory=lambda: deque(maxlen=STDERR_TAIL_LINES))


class TrainabilityJobManager:
    def __init__(
        self,
        *,
        wall_limit_s: float = WALL_LIMIT_SECONDS,
        max_per_owner: int = MAX_JOBS_PER_OWNER,
        max_global: int = MAX_JOBS_GLOBAL,
        extra_env: dict[str, str] | None = None,
        extra_sys_path: list[str] | None = None,
    ) -> None:
        self.wall_limit_s = wall_limit_s
        self.max_per_owner = max_per_owner
        self.max_global = max_global
        self._extra_env = dict(extra_env or {})
        self._extra_sys_path = list(extra_sys_path or [])
        self._lock = threading.Lock()
        self._jobs: dict[str, _Job] = {}

    # ------------------------------------------------------------ queries
    def running(self, owner: int | None = None) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if owner is None or j.owner == owner)

    def pids(self, owner: int | None = None) -> list[int]:
        with self._lock:
            return [j.proc.pid for j in self._jobs.values() if j.proc and (owner is None or j.owner == owner)]

    # -------------------------------------------------------------- start
    def start(self, ctx: LabContext, request: dict[str, Any]) -> None:
        """Spawn the job; raises ``TrainabilityError`` for busy/duplicate/spawn failures.

        ``request`` carries: job_id, code, language, params, observable,
        analyses, settings (already validated and clamped).
        """
        job = _Job(request["job_id"], ctx.owner, ctx, request)
        with self._lock:
            if job.job_id in self._jobs:
                raise TrainabilityError("invalid_request", f"Job '{job.job_id}' is already running.", None)
            mine = sum(1 for j in self._jobs.values() if j.owner == ctx.owner)
            if mine >= self.max_per_owner or len(self._jobs) >= self.max_global:
                raise TrainabilityError(
                    "trainability_busy",
                    "Too many trainability jobs are running. Wait for one to finish or cancel it.",
                )
            self._jobs[job.job_id] = job  # reserve the slot before spawning
        try:
            self._spawn(job)
        except Exception as exc:
            self._forget(job)
            raise TrainabilityError("trainability_internal", f"Could not start the job worker: {exc}") from exc
        ctx.on_release(self._hook_key(job), lambda j=job: self._kill(j, cancelled=True))
        threading.Thread(target=self._pump, args=(job,), name=f"trn-{job.job_id}", daemon=True).start()
        threading.Thread(target=self._watchdog, args=(job,), name=f"trn-wd-{job.job_id}", daemon=True).start()

    def _spawn(self, job: _Job) -> None:
        spec = {
            "code": job.request["code"],
            "language": job.request.get("language"),
            "params": job.request.get("params") or {},
            "observable": job.request.get("observable") or "",
            "analyses": job.request["analyses"],
            "settings": job.request["settings"],
            "sys_path": self._extra_sys_path,
        }
        popen_kwargs: dict[str, Any] = {"start_new_session": True} if os.name == "posix" else {}
        proc = subprocess.Popen(
            [sys.executable, "-I", "-c", _BOOTSTRAP, _REPO_ROOT],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=minimal_env(self._extra_env),
            cwd=_REPO_ROOT,
            text=True,
            encoding="utf-8",
            **popen_kwargs,
        )
        job.proc = proc
        try:
            assert proc.stdin is not None
            proc.stdin.write(json.dumps(to_jsonable(spec)) + "\n")
            proc.stdin.flush()
            proc.stdin.close()
        except OSError:
            pass  # worker died instantly; the pump reports it

    # ------------------------------------------------------------- cancel
    def cancel(self, owner: int, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None or job.owner != owner or job.done:
            return False
        self._kill(job, cancelled=True)
        return True

    def _kill(self, job: _Job, *, cancelled: bool = False, timed_out: bool = False) -> None:
        job.cancelled = job.cancelled or cancelled
        job.timed_out = job.timed_out or timed_out
        if job.proc is not None:
            kill_process_group(job.proc)

    def release_all(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            self._kill(job, cancelled=True)

    # ------------------------------------------------------------- threads
    def _watchdog(self, job: _Job) -> None:
        proc = job.proc
        assert proc is not None
        deadline = time.monotonic() + self.wall_limit_s
        while time.monotonic() < deadline:
            if job.done:
                return
            try:
                proc.wait(timeout=min(0.25, max(0.0, deadline - time.monotonic())))
                return
            except subprocess.TimeoutExpired:
                continue
        if not job.done:
            self._kill(job, timed_out=True)

    def _drain_stderr(self, job: _Job) -> None:
        assert job.proc is not None and job.proc.stderr is not None
        for line in job.proc.stderr:
            job.stderr_tail.append(line.rstrip())

    def _pump(self, job: _Job) -> None:
        proc = job.proc
        assert proc is not None and proc.stdout is not None
        err_thread = threading.Thread(target=self._drain_stderr, args=(job,), daemon=True)
        err_thread.start()
        emit = job.ctx.emit_threadsafe
        emit({"type": "trainability_started", "job_id": job.job_id})
        try:
            for line in proc.stdout:
                self._handle_line(job, line, emit)
        finally:
            proc.wait()
            err_thread.join(timeout=2)
            job.done = True
            self._finish(job, emit)

    def _handle_line(self, job: _Job, line: str, emit) -> None:
        try:
            event = json.loads(line)
        except ValueError:
            return  # stray non-protocol output
        kind = event.get("event")
        if kind == "prepared":
            job.prepared = event
        elif kind == "progress":
            now = time.monotonic()
            if now - job.last_progress >= PROGRESS_MIN_INTERVAL:
                job.last_progress = now
                emit({
                    "type": "trainability_progress", "job_id": job.job_id,
                    "analysis": event["analysis"], "fraction": event["fraction"], "message": event["message"],
                })
        elif kind == "partial":
            job.results[event["analysis"]] = event["result"]
            emit({"type": "trainability_partial", "job_id": job.job_id,
                  "analysis": event["analysis"], "result": event["result"]})
        elif kind == "analysis_error":
            job.errors[event["analysis"]] = {"code": event["code"], "message": event["message"]}
        elif kind == "fatal":
            job.fatal = {k: v for k, v in event.items() if k != "event"}

    def _finish(self, job: _Job, emit) -> None:
        self._forget(job)
        if job.fatal is not None and not job.cancelled:
            emit({"type": "error", "phase": "trainability", "job_id": job.job_id, **job.fatal})
            return
        self._fill_unfinished(job)
        if job.cancelled:
            status = "cancelled"
        elif job.results:
            status = "complete" if not job.timed_out else "failed"
        else:
            status = "failed"
        emit({
            "type": "trainability_result",
            "job_id": job.job_id,
            "status": status,
            "results": job.results,
            "errors": job.errors,
            "elapsed_ms": int((time.monotonic() - job.started) * 1000),
            "provenance": self._provenance(job),
        })

    def _fill_unfinished(self, job: _Job) -> None:
        """Give every analysis that neither finished nor failed an explanation."""
        if job.cancelled:
            return
        if job.timed_out:
            code, message = "wall_limit", f"The job exceeded the {int(self.wall_limit_s)} s wall-clock limit."
        else:
            tail = " | ".join(list(job.stderr_tail)[-3:])
            code, message = "worker_crashed", f"The analysis worker exited unexpectedly. {tail}".strip()
        for analysis in job.request["analyses"]:
            if analysis not in job.results and analysis not in job.errors:
                job.errors[analysis] = {"code": code, "message": message[:500]}

    def _provenance(self, job: _Job) -> dict[str, Any]:
        prepared = job.prepared or {}
        request = job.request
        return build_provenance(
            code=request["code"],
            observable=prepared.get("observable") or (request.get("observable") or ""),
            settings=request["settings"],
            backend=prepared.get("backend") or request["settings"].get("backend", "auto"),
        )

    def _forget(self, job: _Job) -> None:
        with self._lock:
            self._jobs.pop(job.job_id, None)
        job.ctx.forget(self._hook_key(job))

    @staticmethod
    def _hook_key(job: _Job) -> str:
        return f"trainability:{job.job_id}"


_manager = TrainabilityJobManager()


def get_manager() -> TrainabilityJobManager:
    return _manager


def set_manager(manager: TrainabilityJobManager) -> TrainabilityJobManager:
    """Swap the process-wide manager (tests); returns the previous one."""
    global _manager
    previous, _manager = _manager, manager
    return previous
