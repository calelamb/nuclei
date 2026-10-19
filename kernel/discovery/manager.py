"""Discovery job manager (PRD 14 spec 6.6).

A module-level singleton owns a ``ThreadPoolExecutor`` and per-owner
bookkeeping (an *owner* is one websocket connection). Each job runs the
candidate sandbox, then the trusted scorer, each in its own process group;
cancelling a job (or releasing its owner) sets one event that both supervisors
poll, which kills whichever process group is alive. At most
``MAX_QUEUED_PER_OWNER`` unfinished jobs per owner; beyond that ``BusyError``
(wire code ``discovery_busy``).
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

from kernel.discovery.cache import EvaluationCache, cache_key, program_key
from kernel.discovery.constants import (
    CACHE_DIR_ENV,
    CANDIDATE_CPU_DEFAULT,
    DEFAULT_STAGE,
    MAX_QUEUED_PER_OWNER,
    SANDBOX_WALL_SLACK_SECONDS,
)
from kernel.discovery.evaluators import EVALUATORS, effective_config, fingerprint, normalize_config
from kernel.discovery import isolation as iso
from kernel.discovery.sandbox import default_request, prescreen_response, run_candidate
from kernel.discovery.scoring import run_scorer

# stage -> (scorer cpu seconds, scorer wall seconds)
SCORER_BUDGETS: dict[str, tuple[int, int]] = {
    "screen": (60, 90),
    "full": (300, 360),
    "confirm": (300, 360),
}


# Unfinished jobs (queued + running) across ALL connections. Per-owner limits alone let N
# connections queue N * 64 evaluations (RT-M2).
MAX_QUEUED_GLOBAL = 256


class BusyError(RuntimeError):
    """The owner (or the whole kernel) has too many unfinished jobs."""


class ConsentRequiredError(RuntimeError):
    """No OS sandbox exists on this host and the request did not carry ``isolation_consent``.

    ``capability_text`` is the exact wording the consent dialog must show (the user agrees to
    precisely what will happen, not to a generic prompt)."""

    def __init__(self, capability_text: str = iso.PROCESS_CAPABILITY_TEXT):
        super().__init__(capability_text)
        self.capability_text = capability_text


@dataclass
class EvaluateRequest:
    run_id: str
    candidate_id: str
    kind: str
    config: dict[str, Any]
    program: str
    entry: str
    seed: int
    stage: str = DEFAULT_STAGE
    # Per-request, never remembered: the user agreed to run candidates without an OS sandbox.
    isolation_consent: bool = False
    # Who wrote the program ("claude" | "ast" | "symmetry" | "user"); unknown is treated as untrusted.
    origin: str | None = None


@dataclass
class Job:
    owner: int
    request: EvaluateRequest
    emit: Callable[[dict], None]
    cancel_event: threading.Event = field(default_factory=threading.Event)
    finished: bool = False

    @property
    def key(self) -> tuple[str, str]:
        return (self.request.run_id, self.request.candidate_id)


def default_cache_dir() -> str:
    explicit = os.environ.get(CACHE_DIR_ENV)
    if explicit:
        return explicit
    uid = os.getuid() if hasattr(os, "getuid") else 0
    return os.path.join(tempfile.gettempdir(), f"nuclei-discovery-{uid}")


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


class DiscoveryManager:
    def __init__(
        self,
        *,
        max_workers: int | None = None,
        max_queued_global: int = MAX_QUEUED_GLOBAL,
        cache: EvaluationCache | None = None,
        cache_dir: str | None = None,
        sandbox_runner=run_candidate,
        scorer_runner=run_scorer,
        isolation_provider: Callable[[], iso.IsolationInfo] = iso.detect_isolation,
    ):
        self.max_workers = max_workers or max(1, min(4, (os.cpu_count() or 2) - 1))
        self.max_queued_global = max_queued_global
        self._pool = ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix="discovery")
        self.cache = cache if cache is not None else EvaluationCache()
        self._cache_dir = cache_dir
        self._sandbox = sandbox_runner
        self._scorer = scorer_runner
        self._isolation = isolation_provider
        self._lock = threading.Lock()
        self._active: dict[int, list[Job]] = {}

    @property
    def cache_dir(self) -> str:
        return self._cache_dir or default_cache_dir()

    # --- isolation consent -----------------------------------------------------

    def isolation_info(self) -> iso.IsolationInfo:
        """The verified isolation tier (the first call probes the host, so call it off the event loop)."""
        return self._isolation()

    def require_consent(self, consent: bool) -> iso.IsolationInfo:
        """Raise :class:`ConsentRequiredError` on a process-only host unless ``consent`` was given.

        Shared by every message that runs a client-supplied candidate program (``discovery_evaluate``
        and the Red Queen ``discovery_audit``)."""
        info = self.isolation_info()
        if info.needs_consent and not consent:
            raise ConsentRequiredError()
        return info

    def check_consent(self, request: EvaluateRequest) -> iso.IsolationInfo:
        """Raise :class:`ConsentRequiredError` on a process-only host unless the request carries consent."""
        return self.require_consent(request.isolation_consent)

    # --- bookkeeping ---------------------------------------------------------

    def enqueue(self, owner: int, request: EvaluateRequest, emit: Callable[[dict], None]) -> tuple[Job, int]:
        """Reserve a slot; raises BusyError when the owner is full. Call ``launch`` afterwards."""
        job = Job(owner=owner, request=request, emit=emit)
        with self._lock:
            ahead = sum(len(jobs) for jobs in self._active.values())
            if ahead >= self.max_queued_global:
                raise BusyError(f"The kernel already has {ahead} unfinished evaluations; try again shortly.")
            owned = self._active.setdefault(owner, [])
            if len(owned) >= MAX_QUEUED_PER_OWNER:
                raise BusyError(f"At most {MAX_QUEUED_PER_OWNER} evaluations may be queued per connection.")
            owned.append(job)
        return job, max(0, ahead - self.max_workers)

    def launch(self, job: Job) -> None:
        self._pool.submit(self._run_safely, job)

    def _finish(self, job: Job) -> None:
        with self._lock:
            job.finished = True
            owned = self._active.get(job.owner, [])
            if job in owned:
                owned.remove(job)
            if not owned:
                self._active.pop(job.owner, None)

    def pending_count(self, owner: int) -> int:
        with self._lock:
            return len(self._active.get(owner, []))

    def cancel(self, owner: int, run_id: str, candidate_id: str | None = None) -> int:
        with self._lock:
            targets = [
                j for j in self._active.get(owner, [])
                if j.request.run_id == run_id
                and (candidate_id is None or j.request.candidate_id == candidate_id)
                and not j.cancel_event.is_set()
            ]
        for job in targets:
            job.cancel_event.set()
        return len(targets)

    def release_owner(self, owner: int) -> int:
        with self._lock:
            targets = [j for j in self._active.get(owner, []) if not j.cancel_event.is_set()]
        for job in targets:
            job.cancel_event.set()
        return len(targets)

    # --- execution -----------------------------------------------------------

    def _run_safely(self, job: Job) -> None:
        try:
            evaluation = self._evaluate(job)
        except Exception as exc:  # noqa: BLE001 - a job must always answer
            evaluation = self._base_record(job.request, "", "")
            evaluation.update(
                status="failed",
                failure={"stage": "score", "code": "manager_error", "message": f"{type(exc).__name__}: {exc}"},
            )
        finally:
            self._finish(job)
        job.emit({
            "type": "discovery_evaluation",
            "run_id": job.request.run_id,
            "candidate_id": job.request.candidate_id,
            "evaluation": evaluation,
        })

    def _base_record(self, req: EvaluateRequest, fp: str, version: str) -> dict[str, Any]:
        return {
            "candidate_id": req.candidate_id, "run_id": req.run_id, "status": "failed", "fitness": None,
            "objectives": {}, "descriptors": {}, "metrics": {}, "guardrails": [],
            "rejection": None, "failure": None, "stdout": "", "stderr": "",
            "timings_ms": {"sandbox": 0, "score": 0, "total": 0},
            "evaluator": {"kind": req.kind, "version": version, "fingerprint": fp},
            "seed": req.seed, "stage": req.stage, "program_key": program_key(req.program),
            "cache_hit": False, "isolation": "process", "isolation_detail": {"reads": "unrestricted"},
            "compute": {"backend": "numpy", "method": None},
        }

    def _cancelled(self, record: dict[str, Any], stage: str, started: float, timings: dict[str, int]) -> dict[str, Any]:
        record.update(
            status="failed",
            failure={"stage": stage, "code": "cancelled", "message": "Evaluation was cancelled."},
        )
        record["timings_ms"] = {**timings, "total": _ms(time.monotonic() - started)}
        return record

    @staticmethod
    def _apply_sandbox_record(record: dict[str, Any], sandbox: dict[str, Any]) -> None:
        record["isolation"] = sandbox.get("isolation", "process")
        record["isolation_detail"] = sandbox.get("isolation_detail", {"reads": "unrestricted"})
        record["stdout"], record["stderr"] = sandbox.get("stdout", ""), sandbox.get("stderr", "")

    def _sandbox_failed(
        self, record: dict[str, Any], sandbox: dict[str, Any], started: float, timings: dict[str, int], job: Job,
    ) -> dict[str, Any]:
        self._apply_sandbox_record(record, sandbox)
        error = sandbox.get("error") or {"code": "worker_bad_output", "message": "Sandbox failed."}
        if error.get("code") == "cancelled" or job.cancel_event.is_set():
            return self._cancelled(record, "sandbox", started, timings)
        record["failure"] = {"stage": "sandbox", "code": error["code"], "message": error["message"]}
        record["timings_ms"] = {**timings, "total": _ms(time.monotonic() - started)}
        return record

    def _evaluate(self, job: Job) -> dict[str, Any]:
        started = time.monotonic()
        req = job.request
        spec = EVALUATORS[req.kind]
        normalized = normalize_config(spec, req.config)
        fp = fingerprint(req.kind, normalized)
        record = self._base_record(req, fp, spec.version)
        timings = {"sandbox": 0, "score": 0}
        if job.cancel_event.is_set():
            return self._cancelled(record, "sandbox", started, timings)

        rejected = prescreen_response(req.program, self.isolation_info(), req.origin or "claude")
        if rejected is not None:
            return self._sandbox_failed(record, rejected, started, timings, job)

        key = cache_key(req.program, fp, req.seed, req.stage, req.entry)
        hit = self.cache.get(key)
        if hit is not None:
            hit.update(candidate_id=req.candidate_id, run_id=req.run_id, cache_hit=True)
            hit["timings_ms"] = {"sandbox": 0, "score": 0, "total": _ms(time.monotonic() - started)}
            return hit

        config = effective_config(spec, normalized, req.stage)
        request = default_request(spec.task, req.program, req.entry, spec.calls(config), CANDIDATE_CPU_DEFAULT)
        t0 = time.monotonic()
        sandbox = self._sandbox(
            request, wall_seconds=CANDIDATE_CPU_DEFAULT + SANDBOX_WALL_SLACK_SECONDS,
            cancel_event=job.cancel_event,
        )
        timings["sandbox"] = _ms(time.monotonic() - t0)
        if sandbox.get("status") != "ok":
            return self._sandbox_failed(record, sandbox, started, timings, job)
        self._apply_sandbox_record(record, sandbox)

        cpu, wall = SCORER_BUDGETS[req.stage]
        t1 = time.monotonic()
        core = self._scorer(
            {"kind": req.kind, "config": normalized}, sandbox["artifacts"], req.seed,
            stage=req.stage, wall_seconds=wall, cpu_seconds=cpu,
            cache_dir=self.cache_dir, cancel_event=job.cancel_event,
        )
        timings["score"] = _ms(time.monotonic() - t1)
        failure = core.get("failure")
        if core.get("status") == "failed" and failure and failure.get("code") == "cancelled":
            return self._cancelled(record, "score", started, timings)
        for field_name in ("status", "fitness", "objectives", "descriptors", "metrics", "guardrails", "rejection", "failure", "compute"):
            record[field_name] = core.get(field_name, record[field_name])
        record["timings_ms"] = {**timings, "total": _ms(time.monotonic() - started)}
        if record["status"] in ("scored", "rejected") and not job.cancel_event.is_set():
            self.cache.put(key, record)
        return record


_manager: DiscoveryManager | None = None
_manager_lock = threading.Lock()


def get_manager() -> DiscoveryManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = DiscoveryManager()
        return _manager


def set_manager(manager: DiscoveryManager | None) -> None:
    """Replace the singleton (tests)."""
    global _manager
    with _manager_lock:
        _manager = manager
