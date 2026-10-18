"""Conjecture job manager: one killable subprocess per conjecture test.

A sibling of :class:`kernel.trainability.jobs.TrainabilityJobManager` (it reuses its environment and
process-group helpers) with limits of 2 jobs per owner, 4 globally and a 20-minute wall limit. The process
group is killed on cancel, on owner release (connection close) and at the wall limit. Killed jobs report
``cancelled`` or ``failed`` with the partial evidence streamed so far (never a ``supported`` verdict).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from kernel.discovery.conjecture.tester import partial_result
from kernel.lab_context import LabContext
from kernel.trainability._jsonable import to_jsonable
from kernel.trainability.jobs import _REPO_ROOT, kill_process_group, minimal_env

MAX_JOBS_PER_OWNER = 2
MAX_JOBS_GLOBAL = 4
WALL_LIMIT_SECONDS = 20 * 60
PROGRESS_MIN_INTERVAL = 0.1  # <= 10 progress messages per second per job
STDERR_TAIL_LINES = 20
_BOOTSTRAP = (
    "import sys; sys.path.insert(0, sys.argv[1]); "
    "from kernel.discovery.conjecture.worker import main; raise SystemExit(main())"
)


class ConjectureJobError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class _Job:
    job_id: str
    owner: int
    ctx: LabContext
    conjecture: dict[str, Any]
    seed: int
    proc: subprocess.Popen | None = None
    started: float = field(default_factory=time.monotonic)
    cancelled: bool = False
    timed_out: bool = False
    done: bool = False
    result: dict[str, Any] | None = None
    fatal: dict[str, Any] | None = None
    evidence: list[dict[str, Any]] = field(default_factory=list)
    last_progress: float = 0.0
    stderr_tail: deque = field(default_factory=lambda: deque(maxlen=STDERR_TAIL_LINES))


class ConjectureJobManager:
    def __init__(self, *, wall_limit_s: float = WALL_LIMIT_SECONDS, max_per_owner: int = MAX_JOBS_PER_OWNER,
                 max_global: int = MAX_JOBS_GLOBAL, extra_env: dict[str, str] | None = None,
                 extra_sys_path: list[str] | None = None) -> None:
        self.wall_limit_s = wall_limit_s
        self.max_per_owner = max_per_owner
        self.max_global = max_global
        self._extra_env = dict(extra_env or {})
        self._extra_sys_path = list(extra_sys_path or [])
        self._lock = threading.Lock()
        self._jobs: dict[str, _Job] = {}

    def running(self, owner: int | None = None) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if owner is None or j.owner == owner)

    def pids(self, owner: int | None = None) -> list[int]:
        with self._lock:
            return [j.proc.pid for j in self._jobs.values() if j.proc and (owner is None or j.owner == owner)]

    # -------------------------------------------------------------- start
    def start(self, ctx: LabContext, job_id: str, conjecture: dict[str, Any], seed: int) -> None:
        """Spawn the job; raises :class:`ConjectureJobError` (``conjecture_busy``/``invalid_request``/``conjecture_internal``)."""
        job = _Job(job_id, ctx.owner, ctx, conjecture, seed)
        with self._lock:
            if job_id in self._jobs:
                raise ConjectureJobError("invalid_request", f"Job '{job_id}' is already running.")
            mine = sum(1 for j in self._jobs.values() if j.owner == ctx.owner)
            if mine >= self.max_per_owner or len(self._jobs) >= self.max_global:
                raise ConjectureJobError(
                    "conjecture_busy", "Too many conjecture tests are running. Wait for one to finish or cancel it.")
            self._jobs[job_id] = job
        try:
            self._spawn(job)
        except Exception as exc:
            self._forget(job)
            raise ConjectureJobError("conjecture_internal", f"Could not start the test worker: {exc}") from exc
        ctx.on_release(self._hook_key(job), lambda j=job: self._kill(j, cancelled=True))
        threading.Thread(target=self._pump, args=(job,), name=f"cnj-{job_id}", daemon=True).start()
        threading.Thread(target=self._watchdog, args=(job,), name=f"cnj-wd-{job_id}", daemon=True).start()

    def _spawn(self, job: _Job) -> None:
        spec = {"conjecture": job.conjecture, "seed": job.seed, "sys_path": self._extra_sys_path}
        popen_kwargs: dict[str, Any] = {"start_new_session": True} if os.name == "posix" else {}
        proc = subprocess.Popen(
            [sys.executable, "-I", "-c", _BOOTSTRAP, _REPO_ROOT],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=minimal_env(self._extra_env), cwd=_REPO_ROOT, text=True, encoding="utf-8", **popen_kwargs,
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

    # ------------------------------------------------------------ threads
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
        emit({"type": "discovery_conjecture_started", "job_id": job.job_id})
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
            return
        kind = event.get("event")
        if kind == "progress":
            now = time.monotonic()
            if now - job.last_progress >= PROGRESS_MIN_INTERVAL:
                job.last_progress = now
                emit({"type": "discovery_conjecture_progress", "job_id": job.job_id,
                      "fraction": event["fraction"], "message": event["message"],
                      "circuit_index": event["circuit_index"]})
        elif kind == "evidence":
            job.evidence.append(event["item"])
            emit({"type": "discovery_conjecture_evidence", "job_id": job.job_id, "item": event["item"]})
        elif kind == "result":
            job.result = event["result"]
        elif kind == "fatal":
            job.fatal = {k: v for k, v in event.items() if k != "event"}

    def _finish(self, job: _Job, emit) -> None:
        self._forget(job)
        payload: dict[str, Any] = {"type": "discovery_conjecture_result", "job_id": job.job_id}
        if job.cancelled:
            payload.update(status="cancelled", result=self._partial(job, "the test was cancelled"))
        elif job.result is not None:
            payload.update(status="complete", result=job.result)
        else:
            payload.update(status="failed", result=self._partial(job, "the test did not finish"),
                           error=self._error(job))
        emit(payload)

    def _partial(self, job: _Job, reason: str) -> dict[str, Any] | None:
        try:
            return partial_result(job.conjecture, job.evidence, reason, seed=job.seed,
                                  elapsed_ms=int((time.monotonic() - job.started) * 1000))
        except Exception:  # noqa: BLE001 - a partial report must never break the terminal message
            return None

    def _error(self, job: _Job) -> dict[str, Any]:
        if job.timed_out:
            return {"code": "wall_limit", "message": f"The test exceeded the {int(self.wall_limit_s)} s wall-clock limit."}
        if job.fatal is not None:
            return {k: v for k, v in job.fatal.items() if k in ("code", "message", "path")}
        tail = " | ".join(list(job.stderr_tail)[-3:])
        return {"code": "worker_crashed", "message": f"The test worker exited unexpectedly. {tail}".strip()[:500]}

    def _forget(self, job: _Job) -> None:
        with self._lock:
            self._jobs.pop(job.job_id, None)
        job.ctx.forget(self._hook_key(job))

    @staticmethod
    def _hook_key(job: _Job) -> str:
        return f"conjecture:{job.job_id}"


_manager = ConjectureJobManager()


def get_manager() -> ConjectureJobManager:
    return _manager


def set_manager(manager: ConjectureJobManager) -> ConjectureJobManager:
    """Swap the process-wide manager (tests); returns the previous one."""
    global _manager
    previous, _manager = _manager, manager
    return previous
