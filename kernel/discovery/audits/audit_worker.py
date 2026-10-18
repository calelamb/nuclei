"""Trusted audit subprocess (addendum section F).

Launched like the scorer (``sys.executable -I``, minimal env, own session; our
code, not sandboxed). Reads one JSON request from stdin::

    {protocol_version: 1, kind, config, artifacts, seed, evaluation, cache_dir?, cpu_seconds?}

loads ``kernel.discovery.audits.<kind>`` by naming convention and writes one
JSON line: ``{checks, audit_fitness, notes}`` or a coded ``failure``. It never
sees the candidate program, only the fresh sandbox's artifacts.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any

os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["RAYON_NUM_THREADS"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from kernel.agent_limits import WorkerLimits, apply_worker_limits  # noqa: E402
from kernel.discovery.constants import PROTOCOL_VERSION  # noqa: E402

MAX_REQUEST_BYTES = 16 * 1024 * 1024
CPU_MIN, CPU_MAX, CPU_DEFAULT = 1, 1800, 900
_MESSAGE_CAP = 1000
_STATUSES = ("pass", "fail", "warn", "skipped")


def failed(code: str, message: str) -> dict[str, Any]:
    return {"failure": {"code": code, "message": message[:_MESSAGE_CAP]}}


def clamp_cpu(value: Any) -> int:
    try:
        cpu = int(value)
    except (TypeError, ValueError):
        cpu = CPU_DEFAULT
    return max(CPU_MIN, min(CPU_MAX, cpu))


def validate_output(out: Any) -> dict[str, Any]:
    """The audit() contract: checks (well-formed), audit_fitness float|None, notes list[str]."""
    if not isinstance(out, dict) or not isinstance(out.get("checks"), list):
        raise ValueError("audit() must return a dict with a 'checks' list")
    checks = []
    for item in out["checks"]:
        if not (isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("status") in _STATUSES):
            raise ValueError(f"malformed check record: {str(item)[:200]}")
        checks.append({
            "id": item["id"], "label": str(item.get("label", item["id"])),
            "status": item["status"], "detail": item.get("detail"),
        })
    fitness = out.get("audit_fitness")
    if fitness is not None and (isinstance(fitness, bool) or not isinstance(fitness, (int, float))):
        raise ValueError("audit_fitness must be a number or null")
    notes = out.get("notes", [])
    if not isinstance(notes, list):
        raise ValueError("notes must be a list")
    return {"checks": checks, "audit_fitness": None if fitness is None else float(fitness), "notes": [str(n) for n in notes]}


def run_audit(request: dict[str, Any]) -> dict[str, Any]:
    from kernel.discovery.audits import AuditUnavailable, load_audit

    kind, artifacts, seed = request.get("kind"), request.get("artifacts"), request.get("seed")
    if not isinstance(kind, str) or not isinstance(request.get("config"), dict):
        return failed("protocol_error", "kind must be a string and config an object.")
    if isinstance(seed, bool) or not isinstance(seed, int) or not isinstance(artifacts, list):
        return failed("protocol_error", "seed must be an integer and artifacts a list.")
    try:
        module = load_audit(kind)
    except AuditUnavailable as exc:
        return failed("audit_unavailable", str(exc))
    out = module.audit(
        request["config"], artifacts, seed,
        evaluation=request.get("evaluation") or {}, progress=None, cancel=threading.Event(),
        cache_dir=request.get("cache_dir"),
    )
    try:
        return validate_output(out)
    except ValueError as exc:
        return failed("bad_audit_output", str(exc))


def _read_request(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("request too large")
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ValueError(f"request is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(request, dict) or request.get("protocol_version") != PROTOCOL_VERSION:
        raise ValueError("unsupported request")
    return request


def main() -> int:
    out_fd = os.dup(1)
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 1)  # stray prints from libraries must not corrupt the response
    os.close(devnull)
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    try:
        request = _read_request(raw)
        apply_worker_limits(WorkerLimits(cpu_seconds=clamp_cpu(request.get("cpu_seconds"))))
    except ValueError as exc:
        result = failed("protocol_error", str(exc))
    else:
        try:
            result = run_audit(request)
        except InterruptedError:
            result = failed("cancelled", "Audit was cancelled.")
        except BaseException as exc:  # noqa: BLE001 - always answer with a coded failure
            result = failed("audit_exception", f"{type(exc).__name__}: {exc}")
    data = json.dumps({"protocol_version": PROTOCOL_VERSION, **result}, allow_nan=False, default=str).encode() + b"\n"
    view = memoryview(data)
    while view:
        view = view[os.write(out_fd, view):]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
