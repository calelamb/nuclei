"""Trainability job manager: one killable subprocess per job.

Each job runs :mod:`kernel.trainability.job_worker` in its own process group
(``sys.executable -I`` with a minimal explicit environment).  The worker
streams JSON lines; a reader thread turns them into protocol messages.  The
process group is killed on cancel, on owner release (connection close), at
the wall-clock limit and at kernel shutdown.  The subprocess plumbing
(supervision, drain deadline, cancel-vs-result rules) is shared with the
conjecture manager in :mod:`kernel.lab_proc`.
"""

from __future__ import annotations

import atexit
import signal
import time
from dataclasses import dataclass, field
from typing import Any

from kernel.lab_context import LabContext
from kernel.lab_proc import (  # noqa: F401 - minimal_env/kill_process_group re-exported for compatibility
    REPO_ROOT as _REPO_ROOT,
    LabJob,
    LabJobManager,
    kill_process_group,
    minimal_env,
)
from kernel.trainability._errors import TrainabilityError
from kernel.trainability.provenance import build_provenance

MAX_JOBS_PER_OWNER = 2
MAX_JOBS_GLOBAL = 4
WALL_LIMIT_SECONDS = 20 * 60
PROGRESS_MIN_INTERVAL = 0.1  # <= 10 progress messages per second per job
STDERR_TAIL_LINES = 20
_BOOTSTRAP = (
    "import sys; sys.path.insert(0, sys.argv[1]); "
    "from kernel.trainability.job_worker import main; raise SystemExit(main())"
)


@dataclass
class _Job(LabJob):
    request: dict[str, Any] = field(default_factory=dict)
    prepared: dict[str, Any] | None = None
    results: dict[str, Any] = field(default_factory=dict)
    errors: dict[str, dict[str, Any]] = field(default_factory=dict)
    fatal: dict[str, Any] | None = None


class TrainabilityJobManager(LabJobManager):
    BOOTSTRAP = _BOOTSTRAP
    NAME = "trainability"
    ERROR_CLS = TrainabilityError
    BUSY_CODE = "trainability_busy"
    INTERNAL_CODE = "trainability_internal"
    BUSY_MESSAGE = "Too many trainability jobs are running. Wait for one to finish or cancel it."
    SPAWN_FAILED_MESSAGE = "Could not start the job worker"

    def __init__(
        self,
        *,
        wall_limit_s: float = WALL_LIMIT_SECONDS,
        max_per_owner: int = MAX_JOBS_PER_OWNER,
        max_global: int = MAX_JOBS_GLOBAL,
        extra_env: dict[str, str] | None = None,
        extra_sys_path: list[str] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(
            wall_limit_s=wall_limit_s, max_per_owner=max_per_owner, max_global=max_global,
            extra_env=extra_env, extra_sys_path=extra_sys_path, **kwargs,
        )

    # -------------------------------------------------------------- start
    def start(self, ctx: LabContext, request: dict[str, Any]) -> None:
        """Spawn the job; raises ``TrainabilityError`` for busy/duplicate/spawn failures.

        ``request`` carries: job_id, code, language, params, observable,
        analyses, settings (already validated and clamped).
        """
        self._start_job(ctx, _Job(request["job_id"], ctx.owner, ctx, request=request))

    def _spec(self, job: _Job) -> dict[str, Any]:
        return {
            "code": job.request["code"],
            "language": job.request.get("language"),
            "params": job.request.get("params") or {},
            "observable": job.request.get("observable") or "",
            "analyses": job.request["analyses"],
            "settings": job.request["settings"],
        }

    def _started_message(self, job: _Job) -> dict[str, Any]:
        return {"type": "trainability_started", "job_id": job.job_id}

    # -------------------------------------------------------------- events
    def _handle_event(self, job: _Job, event: dict[str, Any], emit) -> None:
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
        elif kind == "done":
            job.completed = True

    def _terminal_message(self, job: _Job) -> dict[str, Any]:
        cancelled = job.cancelled and not job.completed
        if job.fatal is not None and not cancelled:
            return {"type": "error", "phase": "trainability", "job_id": job.job_id, **job.fatal}
        self._fill_unfinished(job, cancelled)
        if cancelled:
            status = "cancelled"
        elif job.results:
            status = "complete" if not job.timed_out else "failed"
        else:
            status = "failed"
        return {
            "type": "trainability_result",
            "job_id": job.job_id,
            "status": status,
            "results": job.results,
            "errors": job.errors,
            "elapsed_ms": int((time.monotonic() - job.started) * 1000),
            "provenance": self._provenance(job),
        }

    def _internal_failure(self, job: _Job, exc: BaseException) -> dict[str, Any]:
        return {"type": "error", "phase": "trainability", "job_id": job.job_id,
                "code": "trainability_internal", "message": f"{type(exc).__name__}: {exc}"[:500]}

    def _fill_unfinished(self, job: _Job, cancelled: bool) -> None:
        """Give every analysis that neither finished nor failed an explanation."""
        if cancelled:
            return
        if job.timed_out:
            code, message = "wall_limit", f"The job exceeded the {int(self.wall_limit_s)} s wall-clock limit."
        elif job.proc is not None and job.proc.returncode == -signal.SIGXCPU:
            code, message = "cpu_limit", "The analysis worker exceeded its CPU-time limit."
        else:
            code, message = "worker_crashed", f"The analysis worker exited unexpectedly. {self.stderr_summary(job)}".strip()
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
            params=request.get("params") or {},
        )


_manager = TrainabilityJobManager()


def get_manager() -> TrainabilityJobManager:
    return _manager


def set_manager(manager: TrainabilityJobManager) -> TrainabilityJobManager:
    """Swap the process-wide manager (tests); returns the previous one."""
    global _manager
    previous, _manager = _manager, manager
    return previous


def _release_at_exit() -> None:
    """Kernel shutdown: no worker may outlive its manager."""
    _manager.release_all()


atexit.register(_release_at_exit)
