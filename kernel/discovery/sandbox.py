"""Supervisor for the candidate worker (PRD 14 spec 6.1).

``run_candidate`` never raises: every failure becomes a response dict with
``status == "error"`` and a coded ``error``. It adds the supervisor-side codes
``worker_timeout``, ``worker_killed``, ``worker_no_output``, ``worker_bad_output``
and ``response_too_large`` to the worker's own codes.
"""

from __future__ import annotations

import json
import os
import signal
import threading
import time
from typing import Any

from kernel.discovery import isolation as iso
from kernel.discovery.constants import (
    CANDIDATE_CPU_DEFAULT,
    MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
    PROTOCOL_VERSION,
)
from kernel.discovery.prescreen import first_rejection_message, prescreen
from kernel.discovery.procrun import (
    ProcResult,
    describe_signal,
    minimal_env,
    python_command,
    run_process,
)

_WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "candidate_worker.py")
_WRAPPER_FAILURE_HINTS = ("sandbox_apply", "bwrap:", "sandbox-exec:", "landlock:")
# Candidate origins whose code is written by a model or another party we do not trust: the static
# pre-screen runs for them at EVERY tier (and for everyone on a plain-process host).
UNTRUSTED_ORIGINS = ("claude",)
ERR_PRESCREEN = "prescreen_rejected"
# Mirrors ``kernel.trainability._decompose.DECOMPOSE_ENV`` (not imported: the supervisor stays light; a test
# pins the two together). The candidate worker's IR conversion keeps rejecting opaque composite gates.
IR_DECOMPOSE_ENV = "NUCLEI_IR_DECOMPOSE"


def _detail(info: iso.IsolationInfo) -> dict[str, str]:
    """What the reported tier really restricts (reads/writes/network); a plain process restricts nothing."""
    return dict(info.detail)


def prescreen_response(program: str, info: iso.IsolationInfo, origin: str | None) -> dict[str, Any] | None:
    """The ``prescreen_rejected`` error response when the pre-screen applies and rejects ``program``.

    Applies on a plain-``process`` tier, and at any tier for an untrusted ``origin``.
    ``None`` means "run it" (not applicable, or clean).
    """
    if info.mode != iso.MODE_PROCESS and origin not in UNTRUSTED_ORIGINS:
        return None
    findings = prescreen(program)
    if not findings:
        return None
    response = _error(ERR_PRESCREEN, first_rejection_message(findings), info)
    response["error"]["rules"] = sorted({f.rule for f in findings})
    return response


def kill_process_group(pgid: int, *, grace_seconds: float = 2.0) -> bool:
    """SIGTERM the group, wait up to ``grace_seconds`` for it to empty, then SIGKILL what is left.

    For jobs that own children (a verify worker running nested candidate sandboxes): a plain SIGKILL
    of the leader orphans them, and an immediate SIGKILL of everything denies them a chance to clean
    up. Returns True when the group was gone (or never existed) without needing SIGKILL.
    """
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return True
        except OSError:
            break
        time.sleep(0.02)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except OSError:
        pass
    return False


def _as_info(isolation: iso.IsolationInfo | str) -> iso.IsolationInfo:
    """Accept a bare tier name (older callers and tests) as well as a full :class:`IsolationInfo`."""
    if isinstance(isolation, iso.IsolationInfo):
        return isolation
    wrapped = isolation in (iso.MODE_BWRAP, iso.MODE_SANDBOX_EXEC, iso.MODE_LANDLOCK)
    return iso.IsolationInfo(
        isolation,
        reads=iso.READS_RESTRICTED if wrapped else iso.READS_UNRESTRICTED,
        writes=iso.WRITES_SCRATCH_ONLY if wrapped else iso.WRITES_UNRESTRICTED,
        network=iso.NETWORK_DENIED if wrapped else iso.NETWORK_UNRESTRICTED,
    )


def _error(code: str, message: str, info: iso.IsolationInfo | str, stderr: str = "") -> dict[str, Any]:
    info = _as_info(info)
    return {
        "protocol_version": PROTOCOL_VERSION,
        "status": "error",
        "artifacts": [],
        "stdout": "",
        "stderr": stderr,
        "error": {"code": code, "message": message},
        "isolation": info.mode,
        "isolation_detail": _detail(info),
    }


def _reject_constant(token: str):
    raise ValueError(f"non-finite JSON constant {token}")


def _single_document(text: str) -> Any:
    """Exactly one JSON document: no second line, no trailing bytes, no NaN/Infinity."""
    value, end = json.JSONDecoder(parse_constant=_reject_constant).raw_decode(text)
    if text[end:].strip():
        raise ValueError("trailing data after the response")
    return value


def _interpret(result: ProcResult, info: iso.IsolationInfo | str) -> dict[str, Any]:
    info = _as_info(info)
    stderr_text = result.stderr.decode("utf-8", "replace")
    if result.spawn_error:
        return _error("worker_no_output", f"Could not start worker: {result.spawn_error}", info)
    if result.cancelled:
        return _error("cancelled", "Evaluation was cancelled.", info)
    if result.timed_out:
        return _error("worker_timeout", "Candidate exceeded its wall-clock budget.", info)
    if result.memory_exceeded:
        return _error(
            "worker_memory_exceeded",
            "Candidate worker exceeded its memory limit and was killed.",
            info,
        )
    if result.output_overflow or len(result.stdout) > MAX_RESPONSE_BYTES:
        return _error("response_too_large", "Worker output exceeded the byte limit; it was killed.", info)
    if result.returncode is not None and result.returncode < 0:
        return _error(
            "worker_killed",
            f"Candidate worker was killed ({describe_signal(result.returncode)}); "
            "this usually means the CPU limit was exceeded.",
            info,
        )
    text = result.stdout.decode("utf-8", "replace").strip()
    if not text and result.returncode is not None and result.returncode > 128:
        # ``bwrap`` (and shells) report a signal death as exit code 128 + signum.
        return _error(
            "worker_killed",
            f"Candidate worker was killed (signal {result.returncode - 128}); "
            "this usually means the CPU limit was exceeded.",
            info,
        )
    if not text:
        return _error(
            "worker_no_output",
            f"Worker produced no response ({describe_signal(result.returncode)}).",
            info,
            stderr_text[:512],
        )
    try:
        response = _single_document(text)
    except ValueError:
        return _error("worker_bad_output", "Worker response was not exactly one valid JSON document.", info)
    if not isinstance(response, dict) or response.get("status") not in ("ok", "error"):
        return _error("worker_bad_output", "Worker response had an unexpected shape.", info)
    response.setdefault("artifacts", [])
    response.setdefault("stdout", "")
    response.setdefault("stderr", "")
    response.setdefault("error", None)
    response["isolation"] = info.mode
    response["isolation_detail"] = _detail(info)
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
    origin: str | None = None,
    project_root: str | None = None,
) -> dict[str, Any]:
    """Run ``request`` in a fresh candidate worker; never raises.

    ``origin`` names who wrote the program. For an untrusted origin (``"claude"``) the static
    pre-screen runs before anything executes, at every tier; on a plain-``process`` tier it runs
    whenever ``origin`` is given (and always on the process fallback after a wrapper failed).
    ``project_root`` is made readable (never writable) where the tier can grant that.
    """
    info = isolation if isolation is not None else iso.detect_isolation()
    try:
        payload = json.dumps(request, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        return _error("protocol_error", f"Request is not strict JSON: {exc}", info)
    if len(payload) > MAX_REQUEST_BYTES:
        return _error("protocol_error", f"Request exceeds {MAX_REQUEST_BYTES} bytes.", info)
    extra_roots = (project_root,) if project_root else ()

    try:
        with iso.private_scratch_dir() as scratch:
            for attempt_info in (info, iso.IsolationInfo(iso.MODE_PROCESS)):
                if origin is not None or attempt_info is not info:
                    rejected = prescreen_response(str(request.get("program", "")), attempt_info, origin or "claude")
                    if rejected is not None:
                        return rejected
                command = attempt_info.command(python_command(_WORKER_PATH), scratch, extra_roots)
                result = run_process(
                    command, payload, wall_seconds=wall_seconds,
                    cancel_event=cancel_event, env=minimal_env({**iso.scratch_env(scratch), IR_DECOMPOSE_ENV: "0"}),
                    max_output_bytes=MAX_RESPONSE_BYTES + 1024,
                )
                wrapped = attempt_info.mode != iso.MODE_PROCESS
                if _wrapper_failed(result, wrapped):
                    if isolation is None:
                        iso.demote(attempt_info, "wrapper failed at runtime")
                    continue
                return _interpret(result, attempt_info)
            return _interpret(result, iso.IsolationInfo(iso.MODE_PROCESS))
    except Exception as exc:  # noqa: BLE001 - the contract is "never raises"
        return _error("worker_no_output", f"Supervisor failure: {type(exc).__name__}: {exc}", info)


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
