"""Supervisor for the candidate worker (PRD 14 spec 6.1).

``run_candidate`` never raises: every failure becomes a response dict with
``status == "error"`` and a coded ``error``. It adds the supervisor-side codes
``worker_timeout``, ``worker_killed``, ``worker_no_output``, ``worker_bad_output``
and ``response_too_large`` to the worker's own codes.
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any

from kernel.discovery import isolation as iso
from kernel.discovery.constants import (
    CANDIDATE_CPU_DEFAULT,
    MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
    PROTOCOL_VERSION,
)
from kernel.discovery.procrun import (
    ProcResult,
    describe_signal,
    minimal_env,
    python_command,
    run_process,
)

_WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "candidate_worker.py")
_WRAPPER_FAILURE_HINTS = ("sandbox_apply", "bwrap:", "sandbox-exec:")


def _error(code: str, message: str, isolation: str, stderr: str = "") -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "status": "error",
        "artifacts": [],
        "stdout": "",
        "stderr": stderr,
        "error": {"code": code, "message": message},
        "isolation": isolation,
    }


def _interpret(result: ProcResult, isolation: str) -> dict[str, Any]:
    stderr_text = result.stderr.decode("utf-8", "replace")
    if result.spawn_error:
        return _error("worker_no_output", f"Could not start worker: {result.spawn_error}", isolation)
    if result.cancelled:
        return _error("cancelled", "Evaluation was cancelled.", isolation)
    if result.timed_out:
        return _error("worker_timeout", "Candidate exceeded its wall-clock budget.", isolation)
    if result.returncode is not None and result.returncode < 0:
        return _error(
            "worker_killed",
            f"Candidate worker was killed ({describe_signal(result.returncode)}); "
            "this usually means the CPU limit was exceeded.",
            isolation,
        )
    if len(result.stdout) > MAX_RESPONSE_BYTES:
        return _error("response_too_large", "Worker response exceeded the byte limit.", isolation)
    text = result.stdout.decode("utf-8", "replace").strip()
    if not text:
        return _error(
            "worker_no_output",
            f"Worker produced no response ({describe_signal(result.returncode)}).",
            isolation,
            stderr_text[:512],
        )
    try:
        response = json.loads(text)
    except ValueError:
        return _error("worker_bad_output", "Worker response was not valid JSON.", isolation)
    if not isinstance(response, dict) or response.get("status") not in ("ok", "error"):
        return _error("worker_bad_output", "Worker response had an unexpected shape.", isolation)
    response.setdefault("artifacts", [])
    response.setdefault("stdout", "")
    response.setdefault("stderr", "")
    response.setdefault("error", None)
    response["isolation"] = isolation
    return response


def _wrapper_failed(result: ProcResult, wrapped: bool) -> bool:
    if not wrapped or result.timed_out or result.cancelled or result.stdout.strip():
        return False
    stderr_text = result.stderr.decode("utf-8", "replace")
    return any(hint in stderr_text for hint in _WRAPPER_FAILURE_HINTS)


def run_candidate(
    request: dict[str, Any],
    *,
    wall_seconds: float,
    cancel_event: threading.Event | None = None,
    isolation: iso.IsolationInfo | None = None,
) -> dict[str, Any]:
    """Run ``request`` in a fresh candidate worker; never raises."""
    info = isolation if isolation is not None else iso.detect_isolation()
    try:
        payload = json.dumps(request, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        return _error("protocol_error", f"Request is not strict JSON: {exc}", info.mode)
    if len(payload) > MAX_REQUEST_BYTES:
        return _error("protocol_error", f"Request exceeds {MAX_REQUEST_BYTES} bytes.", info.mode)

    try:
        for attempt_info in (info, iso.IsolationInfo(iso.MODE_PROCESS)):
            command = attempt_info.wrap(python_command(_WORKER_PATH))
            result = run_process(
                command, payload, wall_seconds=wall_seconds,
                cancel_event=cancel_event, env=minimal_env(),
            )
            wrapped = attempt_info.mode != iso.MODE_PROCESS
            if _wrapper_failed(result, wrapped):
                if isolation is None:
                    iso.demote(attempt_info, "wrapper failed at runtime")
                continue
            return _interpret(result, attempt_info.mode)
        return _interpret(result, iso.MODE_PROCESS)
    except Exception as exc:  # noqa: BLE001 - the contract is "never raises"
        return _error("worker_no_output", f"Supervisor failure: {type(exc).__name__}: {exc}", info.mode)


def default_request(
    task: str, program: str, entry: str, calls: list[dict[str, Any]], cpu_seconds: int = CANDIDATE_CPU_DEFAULT
) -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "task": task,
        "program": program,
        "entry": entry,
        "calls": calls,
        "cpu_seconds": cpu_seconds,
    }
