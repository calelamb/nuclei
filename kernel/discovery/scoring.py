"""Supervisor for the trusted scorer subprocess (PRD 14 spec 6.2)."""

from __future__ import annotations

import json
import os
import threading
from typing import Any

from kernel.discovery.constants import MAX_RESPONSE_BYTES, PROTOCOL_VERSION, SCORER_CPU_DEFAULT
from kernel.discovery.procrun import describe_signal, minimal_env, python_command, run_process

_WORKER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "score_worker.py")
_SCORER_MAX_BYTES = 8 * MAX_RESPONSE_BYTES


def _failure(code: str, message: str) -> dict[str, Any]:
    return {
        "status": "failed", "fitness": None, "objectives": {}, "descriptors": {}, "metrics": {},
        "guardrails": [], "rejection": None,
        "failure": {"stage": "score", "code": code, "message": message},
        "compute": {"backend": "numpy", "method": None},
    }


def run_scorer(
    evaluator: dict[str, Any],
    artifacts: list[dict[str, Any]],
    seed: int,
    *,
    stage: str,
    wall_seconds: float,
    cpu_seconds: int = SCORER_CPU_DEFAULT,
    cache_dir: str | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """Run the scorer; never raises. Returns an evaluation core dict."""
    request = {
        "protocol_version": PROTOCOL_VERSION,
        "evaluator": evaluator,
        "artifacts": artifacts,
        "seed": seed,
        "stage": stage,
        "cache_dir": cache_dir,
        "cpu_seconds": cpu_seconds,
    }
    try:
        payload = json.dumps(request, separators=(",", ":"), allow_nan=False).encode("utf-8")
        result = run_process(
            python_command(_WORKER_PATH), payload,
            wall_seconds=wall_seconds, cancel_event=cancel_event, env=minimal_env(),
        )
    except Exception as exc:  # noqa: BLE001 - supervisor contract: never raise
        return _failure("worker_no_output", f"Scorer supervisor failure: {type(exc).__name__}: {exc}")
    if result.spawn_error:
        return _failure("worker_no_output", f"Could not start scorer: {result.spawn_error}")
    if result.cancelled:
        return _failure("cancelled", "Evaluation was cancelled.")
    if result.timed_out:
        return _failure("worker_timeout", "Scoring exceeded its wall-clock budget.")
    if result.returncode is not None and result.returncode < 0:
        return _failure("worker_killed", f"Scorer was killed ({describe_signal(result.returncode)}).")
    if len(result.stdout) > _SCORER_MAX_BYTES:
        return _failure("response_too_large", "Scorer response exceeded the byte limit.")
    text = result.stdout.decode("utf-8", "replace").strip()
    if not text:
        tail = result.stderr.decode("utf-8", "replace").strip()[-300:]
        return _failure("worker_no_output", f"Scorer produced no response. {tail}".strip())
    try:
        response = json.loads(text)
    except ValueError:
        return _failure("worker_bad_output", "Scorer response was not valid JSON.")
    if not isinstance(response, dict) or response.get("status") not in ("scored", "rejected", "failed"):
        return _failure("worker_bad_output", "Scorer response had an unexpected shape.")
    response.pop("protocol_version", None)
    return response
