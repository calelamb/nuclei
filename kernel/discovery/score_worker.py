"""Trusted scorer subprocess (PRD 14 spec 6.2).

Launched like the candidate worker (``sys.executable -I``, minimal env, own
session) but NOT sandboxed against imports: it is our code. It reads one JSON
request from stdin::

    {protocol_version: 1, evaluator: {kind, config}, artifacts, seed,
     stage?: "screen"|"full"|"confirm", cache_dir?, cpu_seconds?}

and writes one JSON line: the evaluation core (status, fitness, objectives,
descriptors, metrics, guardrails, rejection, failure, compute). It never sees
the candidate program, only the artifacts the sandbox produced.
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
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from kernel.agent_limits import WorkerLimits, apply_worker_limits  # noqa: E402
from kernel.discovery.constants import (  # noqa: E402
    DEFAULT_STAGE,
    PROTOCOL_VERSION,
    SCORER_CPU_DEFAULT,
    SCORER_CPU_MAX,
    SCORER_CPU_MIN,
    VALID_STAGES,
)

MAX_REQUEST_BYTES = 16 * 1024 * 1024
_MESSAGE_CAP = 1000


def clamp_cpu(value: Any) -> int:
    try:
        cpu = int(value)
    except (TypeError, ValueError):
        cpu = SCORER_CPU_DEFAULT
    return max(SCORER_CPU_MIN, min(SCORER_CPU_MAX, cpu))


def failed(code: str, message: str) -> dict[str, Any]:
    return {
        "status": "failed", "fitness": None, "objectives": {}, "descriptors": {}, "metrics": {},
        "guardrails": [], "rejection": None,
        "failure": {"stage": "score", "code": code, "message": message[:_MESSAGE_CAP]},
        "compute": {"backend": "numpy", "method": None},
    }


def evaluate(request: dict[str, Any]) -> dict[str, Any]:
    from kernel.discovery.evaluators import EVALUATORS, InvalidConfig, effective_config, normalize_config

    evaluator = request.get("evaluator")
    if not isinstance(evaluator, dict) or evaluator.get("kind") not in EVALUATORS:
        return failed("unknown_evaluator", f"Unknown evaluator {evaluator!r}.")
    spec = EVALUATORS[evaluator["kind"]]
    from kernel.discovery._optional import missing_message
    from kernel.discovery.evaluators import missing_for

    absent = missing_for(spec.kind)
    if absent:  # the handler fails fast; this covers a package removed after the job was queued
        return failed("missing_dependency", missing_message(absent))
    stage = request.get("stage", DEFAULT_STAGE)
    if stage not in VALID_STAGES:
        return failed("protocol_error", f"Invalid stage {stage!r}.")
    seed = request.get("seed")
    artifacts = request.get("artifacts")
    if isinstance(seed, bool) or not isinstance(seed, int) or not isinstance(artifacts, list):
        return failed("protocol_error", "seed must be an integer and artifacts a list.")
    try:
        config = effective_config(spec, normalize_config(spec, evaluator.get("config")), stage)
    except InvalidConfig as exc:
        return failed("invalid_config", str(exc))
    cancel = threading.Event()
    core = spec.score(
        config, artifacts, seed, None, cancel,
        stage=stage, cache_dir=request.get("cache_dir"),
    )
    return core.to_dict()


def _read_request(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("request too large")
    try:
        request = json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise ValueError(f"request is not UTF-8: {exc}") from exc
    if not isinstance(request, dict) or request.get("protocol_version") != PROTOCOL_VERSION:
        raise ValueError("unsupported request")
    return request


def _encode_response(result: dict[str, Any]) -> bytes:
    """Serialise the one response line; NaN/Infinity or an unserialisable value becomes a coded failure."""
    try:
        return json.dumps({"protocol_version": PROTOCOL_VERSION, **result}, allow_nan=False, default=str).encode() + b"\n"
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        fallback = failed("non_finite_result", f"Result could not be serialised as strict JSON: {type(exc).__name__}")
        return json.dumps({"protocol_version": PROTOCOL_VERSION, **fallback}, allow_nan=False).encode() + b"\n"


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
            result = evaluate(request)
        except InterruptedError:
            result = failed("cancelled", "Evaluation was cancelled.")
        except BaseException as exc:  # noqa: BLE001 - always answer with a coded failure
            result = failed("scorer_exception", f"{type(exc).__name__}: {exc}")
    data = _encode_response(result)
    view = memoryview(data)
    while view:
        view = view[os.write(out_fd, view):]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
