"""Audit execution and job bookkeeping (addendum section F).

``run_audit_job`` re-runs the candidate in a FRESH sandbox (twice, to expose
non-determinism), derives a different seed, then calls ``audit()`` in a trusted
subprocess and turns the checks into a verdict:

* ``exploit``      - any check fails while the evaluator had ``scored`` the candidate;
* ``inconclusive`` - a check could not run, or a budget was exceeded;
* ``consistent``   - otherwise.

``AuditManager`` mirrors ``DiscoveryManager`` (per-owner cap, cancel, release)
but owns a small separate pool, so a 2-minute exact search can never starve
ordinary evaluations of workers.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable

from kernel.discovery.constants import (
    CANDIDATE_CPU_DEFAULT, MAX_QUEUED_PER_OWNER, PROTOCOL_VERSION, SANDBOX_WALL_SLACK_SECONDS, MAX_RESPONSE_BYTES,
)
from kernel.discovery.evaluators import EVALUATORS, effective_config, fingerprint, normalize_config
from kernel.discovery.evaluators.base import source_closure
from kernel.discovery.procrun import describe_signal, minimal_env, python_command, run_process
from kernel.discovery.sandbox import ERR_PRESCREEN, UNTRUSTED_ORIGINS, default_request, run_candidate

AUDIT_STAGE = "full"
AUDIT_CPU_SECONDS = 900
AUDIT_WALL_SECONDS = 1200
AUDIT_POOL_WORKERS = 2
_WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit_worker.py")
#: Sandbox failures that say nothing about the candidate (resources, cancellation).
TRANSIENT_SANDBOX_CODES = frozenset({"cancelled", "worker_timeout", "worker_killed", "worker_no_output", "response_too_large"})


def derive_audit_seed(seed: int) -> int:
    """A different, deterministic seed: the audit never reuses the evaluator's randomness."""
    digest = hashlib.sha256(f"audit-seed:{int(seed)}".encode()).digest()
    return int.from_bytes(digest[:8], "little") & 0x7FFF_FFFF_FFFF_FFFF


_fp_lock = threading.Lock()
_fp_cache: dict[str, str] = {}


def audit_fingerprint(kind: str) -> str:
    """SHA-256 over ``audits/<kind>.py`` and every ``kernel/discovery`` module it imports."""
    with _fp_lock:
        cached = _fp_cache.get(kind)
        if cached is None:
            digest = hashlib.sha256()
            digest.update(b"audit\0" + kind.encode() + b"\0")
            for name, data in sorted(source_closure(f"kernel.discovery.audits.{kind}").items()):
                digest.update(name.encode() + b"\0" + data + b"\0")
            cached = _fp_cache[kind] = digest.hexdigest()
        return cached


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def _check(check_id: str, label: str, status: str, detail: str | None) -> dict[str, Any]:
    return {"id": check_id, "label": label, "status": status, "detail": detail}


@dataclass
class AuditRequest:
    run_id: str
    candidate_id: str
    kind: str
    config: dict[str, Any]
    program: str
    entry: str
    seed: int
    evaluation: dict[str, Any]
    origin: str | None = None  # who wrote the program; missing is untrusted ('claude'), as in the manager


def decide(evaluation_status: str | None, checks: list[dict[str, Any]]) -> tuple[str, list[str]]:
    """Verdict and human-readable reasons from the checks (pure; unit-tested)."""
    failed = [c for c in checks if c["status"] == "fail"]
    skipped = [c for c in checks if c["status"] == "skipped"]
    describe = lambda c: f"{c['id']}: {c.get('detail') or c.get('label')}"  # noqa: E731
    if evaluation_status != "scored":
        if failed:
            return "consistent", [f"evaluator status '{evaluation_status}'; the audit agrees ({failed[0]['id']} fails)."]
        return "inconclusive", [f"evaluator status '{evaluation_status}', yet no audit check fails; the rejection may be a false positive."]
    if failed:
        return "exploit", [describe(c) for c in failed]
    if skipped:
        return "inconclusive", [describe(c) for c in skipped]
    return "consistent", []


def _sandbox_once(spec, config: dict[str, Any], req: AuditRequest, sandbox_runner, cancel: threading.Event) -> dict[str, Any]:
    request = default_request(spec.task, req.program, req.entry, spec.calls(config), CANDIDATE_CPU_DEFAULT)
    return sandbox_runner(
        request, wall_seconds=CANDIDATE_CPU_DEFAULT + SANDBOX_WALL_SLACK_SECONDS, cancel_event=cancel,
        origin=req.origin or UNTRUSTED_ORIGINS[0],
    )


def _canonical(artifacts: Any) -> str:
    return json.dumps(artifacts, sort_keys=True, separators=(",", ":"), default=str)


def _sandbox_failure_check(sandbox: dict[str, Any], scored: bool) -> dict[str, Any]:
    error = sandbox.get("error") or {"code": "worker_bad_output", "message": "sandbox failed"}
    transient = error.get("code") in TRANSIENT_SANDBOX_CODES
    # Decision: a candidate the static pre-screen refuses never ran, so the audit cannot say anything
    # about it: skipped (-> inconclusive), never a reproducibility 'exploit'.
    prescreened = error.get("code") == ERR_PRESCREEN
    status = "skipped" if transient or prescreened or not scored else "fail"
    detail = f"fresh sandbox run failed: {error.get('code')}: {error.get('message')}"
    if prescreened:
        detail = f"rejected by the pre-screen before it ran, so the audit cannot judge it: {error.get('message')}"
    if status == "fail":
        detail += " (it succeeded when the evaluator ran it, so the candidate is not reproducible)"
    return _check("sandbox_reproducible", "Candidate reproduces in a fresh sandbox", status, detail[:600])


def run_audit_worker(
    req: AuditRequest, config: dict[str, Any], artifacts: list[dict[str, Any]], audit_seed: int,
    cache_dir: str | None, cancel: threading.Event,
) -> dict[str, Any]:
    """Run ``audit()`` in the trusted subprocess; never raises. Returns output or ``{"failure": ...}``."""
    payload = {
        "protocol_version": PROTOCOL_VERSION, "kind": req.kind, "config": config, "artifacts": artifacts,
        "seed": audit_seed, "evaluation": req.evaluation, "cache_dir": cache_dir, "cpu_seconds": AUDIT_CPU_SECONDS,
    }
    try:
        data = json.dumps(payload, separators=(",", ":"), allow_nan=False, default=str).encode("utf-8")
        proc = run_process(
            python_command(_WORKER_PATH), data, wall_seconds=AUDIT_WALL_SECONDS, cancel_event=cancel, env=minimal_env(),
        )
    except Exception as exc:  # noqa: BLE001 - supervisor contract: never raise
        return {"failure": {"code": "audit_supervisor", "message": f"{type(exc).__name__}: {exc}"}}
    if proc.cancelled:
        return {"failure": {"code": "cancelled", "message": "Audit was cancelled."}}
    if proc.timed_out:
        return {"failure": {"code": "budget_exceeded", "message": f"Audit exceeded its {AUDIT_WALL_SECONDS} s budget."}}
    if proc.returncode is not None and proc.returncode < 0:
        return {"failure": {"code": "budget_exceeded", "message": f"Audit worker was killed ({describe_signal(proc.returncode)}), likely its CPU limit."}}
    if len(proc.stdout) > 8 * MAX_RESPONSE_BYTES or not proc.stdout.strip():
        return {"failure": {"code": "worker_no_output", "message": "Audit worker produced no usable response."}}
    try:
        out = json.loads(proc.stdout.decode("utf-8", "replace"))
    except ValueError:
        return {"failure": {"code": "worker_bad_output", "message": "Audit worker response was not valid JSON."}}
    return out if isinstance(out, dict) else {"failure": {"code": "worker_bad_output", "message": "unexpected shape"}}


def _empty_record(req: AuditRequest, fp: str, version: str, audit_fp: str) -> dict[str, Any]:
    return {
        "verdict": "inconclusive", "evaluator_fitness": req.evaluation.get("fitness"), "audit_fitness": None, "gap": None,
        "checks": [], "reasons": [], "evaluator": {"kind": req.kind, "version": version, "fingerprint": fp},
        "audit_fingerprint": audit_fp, "seed": req.seed, "audit_seed": derive_audit_seed(req.seed),
        "isolation": "process", "timings_ms": {"sandbox": 0, "audit": 0, "total": 0}, "notes": [],
    }


def _finish(record: dict[str, Any], evaluation_status: str | None, started: float, timings: dict[str, int]) -> dict[str, Any]:
    verdict, reasons = decide(evaluation_status, record["checks"])
    ev, au = record["evaluator_fitness"], record["audit_fitness"]
    gap = float(ev) - float(au) if isinstance(ev, (int, float)) and isinstance(au, (int, float)) else None
    return {**record, "verdict": verdict, "reasons": reasons, "gap": gap,
            "timings_ms": {**timings, "total": _ms(time.monotonic() - started)}}


def run_audit_job(
    req: AuditRequest,
    cancel: threading.Event,
    *,
    cache_dir: str | None = None,
    sandbox_runner: Callable[..., dict[str, Any]] = run_candidate,
    worker_runner: Callable[..., dict[str, Any]] = run_audit_worker,
) -> dict[str, Any]:
    """Produce the ``audit`` record of the protocol; never raises."""
    started = time.monotonic()
    spec = EVALUATORS[req.kind]
    normalized = normalize_config(spec, req.config)
    config = effective_config(spec, normalized, AUDIT_STAGE)
    record = _empty_record(req, fingerprint(req.kind, normalized), spec.version, audit_fingerprint(req.kind))
    status = req.evaluation.get("status") if isinstance(req.evaluation, dict) else None
    scored = status == "scored"
    timings = {"sandbox": 0, "audit": 0}
    if cancel.is_set():
        return _finish({**record, "checks": [_check("cancelled", "Audit ran", "skipped", "cancelled")]}, status, started, timings)

    t0 = time.monotonic()
    first = _sandbox_once(spec, config, req, sandbox_runner, cancel)
    second = _sandbox_once(spec, config, req, sandbox_runner, cancel) if first.get("status") == "ok" else first
    timings["sandbox"] = _ms(time.monotonic() - t0)
    record["isolation"] = first.get("isolation", "process")
    if first.get("status") != "ok" or second.get("status") != "ok":
        failing = first if first.get("status") != "ok" else second
        return _finish({**record, "checks": [_sandbox_failure_check(failing, scored)]}, status, started, timings)
    checks = []
    identical = _canonical(first["artifacts"]) == _canonical(second["artifacts"])
    checks.append(_check(
        "candidate_deterministic", "Candidate output is identical across fresh sandbox runs",
        "pass" if identical else "fail",
        None if identical else "two fresh runs of the same program returned different circuits (time/entropy/environment dependence).",
    ))
    t1 = time.monotonic()
    out = worker_runner(req, config, first["artifacts"], derive_audit_seed(req.seed), cache_dir, cancel)
    timings["audit"] = _ms(time.monotonic() - t1)
    failure = out.get("failure")
    if failure:
        checks.append(_check("audit_run", "Audit ran to completion", "skipped", f"{failure.get('code')}: {failure.get('message')}"))
        return _finish({**record, "checks": checks}, status, started, timings)
    return _finish(
        {**record, "checks": checks + list(out.get("checks", [])), "audit_fitness": out.get("audit_fitness"),
         "notes": list(out.get("notes", []))},
        status, started, timings,
    )


# --- job bookkeeping ------------------------------------------------------------


@dataclass
class AuditJob:
    owner: int
    request: AuditRequest
    emit: Callable[[dict], None]
    cancel_event: threading.Event = field(default_factory=threading.Event)


class BusyError(RuntimeError):
    """The owner already has ``MAX_QUEUED_PER_OWNER`` unfinished audits."""


class AuditManager:
    def __init__(self, *, max_workers: int = AUDIT_POOL_WORKERS, cache_dir: str | None = None, job_runner=run_audit_job):
        self.max_workers = max_workers
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="discovery-audit")
        self._cache_dir = cache_dir
        self._job_runner = job_runner
        self._lock = threading.Lock()
        self._active: dict[int, list[AuditJob]] = {}

    @property
    def cache_dir(self) -> str:
        if self._cache_dir:
            return self._cache_dir
        from kernel.discovery.manager import default_cache_dir

        return default_cache_dir()

    def enqueue(self, owner: int, request: AuditRequest, emit: Callable[[dict], None]) -> tuple[AuditJob, int]:
        job = AuditJob(owner, request, emit)
        with self._lock:
            owned = self._active.setdefault(owner, [])
            if len(owned) >= MAX_QUEUED_PER_OWNER:
                raise BusyError(f"At most {MAX_QUEUED_PER_OWNER} audits may be queued per connection.")
            ahead = sum(len(jobs) for jobs in self._active.values())
            owned.append(job)
        return job, max(0, ahead - self.max_workers)

    def launch(self, job: AuditJob) -> None:
        self._pool.submit(self._run_safely, job)

    def _finish(self, job: AuditJob) -> None:
        with self._lock:
            owned = self._active.get(job.owner, [])
            if job in owned:
                owned.remove(job)
            if not owned:
                self._active.pop(job.owner, None)

    def pending_count(self, owner: int) -> int:
        with self._lock:
            return len(self._active.get(owner, []))

    def _run_safely(self, job: AuditJob) -> None:
        req = job.request
        try:
            audit = self._job_runner(req, job.cancel_event, cache_dir=self.cache_dir)
        except Exception as exc:  # noqa: BLE001 - a job must always answer
            audit = _empty_record(req, "", "", "")
            audit["checks"] = [_check("audit_run", "Audit ran to completion", "skipped", f"{type(exc).__name__}: {exc}"[:600])]
            audit["reasons"] = [audit["checks"][0]["detail"]]
        finally:
            self._finish(job)
        job.emit({"type": "discovery_audit_result", "run_id": req.run_id, "candidate_id": req.candidate_id, "audit": audit})

    def cancel(self, owner: int, run_id: str, candidate_id: str | None = None) -> int:
        with self._lock:
            targets = [
                j for j in self._active.get(owner, [])
                if j.request.run_id == run_id and (candidate_id is None or j.request.candidate_id == candidate_id)
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


_manager: AuditManager | None = None
_manager_lock = threading.Lock()


def get_audit_manager() -> AuditManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = AuditManager()
        return _manager


def set_audit_manager(manager: AuditManager | None) -> None:
    """Replace the singleton (tests)."""
    global _manager
    with _manager_lock:
        _manager = manager
