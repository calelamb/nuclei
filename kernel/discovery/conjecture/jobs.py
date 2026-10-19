"""Conjecture job manager: one killable subprocess per conjecture test.

A sibling of :class:`kernel.trainability.jobs.TrainabilityJobManager`: both subclass
:class:`kernel.lab_proc.LabJobManager`, which owns the subprocess supervision (limits of 2 jobs per owner,
4 globally, a 20-minute wall limit, a drain deadline so a grandchild holding stdout cannot block the terminal
message, parent-death safety).  The process group is killed on cancel, on owner release (connection close),
at the wall limit and at kernel shutdown.  Killed jobs report ``cancelled`` or ``failed`` with the partial
evidence streamed so far (never a ``supported`` verdict); a delivered result always wins over a late cancel.
"""

from __future__ import annotations

import atexit
import signal
import time
from dataclasses import dataclass, field
from typing import Any

from kernel.discovery.conjecture.tester import partial_result
from kernel.lab_context import LabContext
from kernel.lab_proc import LabJob, LabJobManager

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
class _Job(LabJob):
    conjecture: dict[str, Any] = field(default_factory=dict)
    seed: int = 0
    result: dict[str, Any] | None = None
    fatal: dict[str, Any] | None = None
    evidence: list[dict[str, Any]] = field(default_factory=list)


class ConjectureJobManager(LabJobManager):
    BOOTSTRAP = _BOOTSTRAP
    NAME = "conjecture"
    ERROR_CLS = ConjectureJobError
    BUSY_CODE = "conjecture_busy"
    INTERNAL_CODE = "conjecture_internal"
    BUSY_MESSAGE = "Too many conjecture tests are running. Wait for one to finish or cancel it."
    SPAWN_FAILED_MESSAGE = "Could not start the test worker"

    def __init__(self, *, wall_limit_s: float = WALL_LIMIT_SECONDS, max_per_owner: int = MAX_JOBS_PER_OWNER,
                 max_global: int = MAX_JOBS_GLOBAL, extra_env: dict[str, str] | None = None,
                 extra_sys_path: list[str] | None = None, **kwargs: Any) -> None:
        super().__init__(wall_limit_s=wall_limit_s, max_per_owner=max_per_owner, max_global=max_global,
                         extra_env=extra_env, extra_sys_path=extra_sys_path, **kwargs)

    def start(self, ctx: LabContext, job_id: str, conjecture: dict[str, Any], seed: int) -> None:
        """Spawn the job; raises :class:`ConjectureJobError` (``conjecture_busy``/``invalid_request``/``conjecture_internal``)."""
        self._start_job(ctx, _Job(job_id, ctx.owner, ctx, conjecture=conjecture, seed=seed))

    def _spec(self, job: _Job) -> dict[str, Any]:
        return {"conjecture": job.conjecture, "seed": job.seed}

    def _started_message(self, job: _Job) -> dict[str, Any]:
        return {"type": "discovery_conjecture_started", "job_id": job.job_id}

    def _handle_event(self, job: _Job, event: dict[str, Any], emit) -> None:
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
            job.completed = True
        elif kind == "fatal":
            job.fatal = {k: v for k, v in event.items() if k != "event"}

    def _terminal_message(self, job: _Job) -> dict[str, Any]:
        payload: dict[str, Any] = {"type": "discovery_conjecture_result", "job_id": job.job_id}
        if job.result is not None:  # a delivered result is never overridden by a racing cancel
            payload.update(status="complete", result=job.result)
        elif job.cancelled:
            payload.update(status="cancelled", result=self._partial(job, "the test was cancelled"))
        else:
            payload.update(status="failed", result=self._partial(job, "the test did not finish"),
                           error=self._error_payload(job))
        return payload

    def _internal_failure(self, job: _Job, exc: BaseException) -> dict[str, Any]:
        return {"type": "discovery_conjecture_result", "job_id": job.job_id, "status": "failed", "result": None,
                "error": {"code": "conjecture_internal", "message": f"{type(exc).__name__}: {exc}"[:500]}}

    def _partial(self, job: _Job, reason: str) -> dict[str, Any] | None:
        try:
            return partial_result(job.conjecture, job.evidence, reason, seed=job.seed,
                                  elapsed_ms=int((time.monotonic() - job.started) * 1000))
        except Exception:  # noqa: BLE001 - a partial report must never break the terminal message
            return None

    def _error_payload(self, job: _Job) -> dict[str, Any]:
        if job.timed_out:
            return {"code": "wall_limit", "message": f"The test exceeded the {int(self.wall_limit_s)} s wall-clock limit."}
        if job.fatal is not None:
            return {k: v for k, v in job.fatal.items() if k in ("code", "message", "path")}
        if job.proc is not None and job.proc.returncode == -signal.SIGXCPU:
            return {"code": "cpu_limit", "message": "The test worker exceeded its CPU-time limit."}
        return {"code": "worker_crashed",
                "message": f"The test worker exited unexpectedly. {self.stderr_summary(job)}".strip()[:500]}


_manager = ConjectureJobManager()


def get_manager() -> ConjectureJobManager:
    return _manager


def set_manager(manager: ConjectureJobManager) -> ConjectureJobManager:
    """Swap the process-wide manager (tests); returns the previous one."""
    global _manager
    previous, _manager = _manager, manager
    return previous


def _release_at_exit() -> None:
    """Kernel shutdown: no worker may outlive its manager."""
    _manager.release_all()


atexit.register(_release_at_exit)
