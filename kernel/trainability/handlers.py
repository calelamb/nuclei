"""Trainability Lab message handlers (protocol v1.3).

``handle(msg, ctx)`` is called by ``kernel/server.py`` for every
``trainability_*`` message.  Sync requests (inspect, lint) run in a worker
thread (``asyncio.to_thread``, like parse/execute); jobs run in a subprocess (see ``jobs.py``).
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import time
from typing import Any

from kernel.lab_context import LabContext
from kernel.lab_protocol import request_id_problem, with_request_id
from kernel.trainability._errors import TrainabilityError, normalize_error
from kernel.trainability._settings import normalize_analyses, normalize_settings
from kernel.trainability.inspect import inspect_code, load_for_lint, source_lines
from kernel.trainability.jobs import get_manager

LINT_TIME_BUDGET_S = 0.35  # spec: lint compute budget <= 0.5 s including conversion
logger = logging.getLogger(__name__)
MAX_JOB_ID_LENGTH = 128
MAX_CODE_BYTES = 1_000_000


def error_envelope(err: TrainabilityError, job_id: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"type": "error", "phase": "trainability", "code": err.code, "message": err.message}
    if job_id is not None:
        payload["job_id"] = job_id
    if err.column is not None:
        payload["column"] = err.column
    return payload


# --------------------------------------------------------------- validation


def _code(msg: dict) -> str:
    code = msg.get("code")
    if not isinstance(code, str) or not code.strip():
        raise TrainabilityError("invalid_request", "`code` must be a non-empty string.")
    try:
        size = len(code.encode("utf-8"))
    except UnicodeEncodeError as exc:  # a lone surrogate, e.g. a truncated emoji pair
        raise TrainabilityError("invalid_request", "`code` is not valid Unicode text (lone surrogate).") from exc
    if size > MAX_CODE_BYTES:
        raise TrainabilityError("invalid_request", "`code` is too large.")
    return code


def _language(msg: dict) -> str | None:
    language = msg.get("language")
    if language is not None and not isinstance(language, str):
        raise TrainabilityError("invalid_request", "`language` must be a string.")
    return language


def _params(msg: dict) -> dict[str, Any]:
    params = msg.get("params")
    if params is None:
        return {}
    if not isinstance(params, dict) or not all(isinstance(k, str) for k in params):
        raise TrainabilityError("invalid_request", "`params` must be an object.")
    return params


def _optional_observable(msg: dict) -> str | None:
    observable = msg.get("observable")
    if observable is None:
        return None
    if not isinstance(observable, str):
        raise TrainabilityError("invalid_request", "`observable` must be a string.")
    return observable


def _job_id(msg: dict) -> str:
    job_id = msg.get("job_id")
    if not isinstance(job_id, str) or not job_id.strip() or len(job_id) > MAX_JOB_ID_LENGTH:
        raise TrainabilityError("invalid_request", "`job_id` must be a non-empty string.")
    return job_id


# -------------------------------------------------------------- sync paths


def _lint_sync(msg: dict) -> dict[str, Any]:
    code, language, params = _code(msg), _language(msg), _params(msg)
    started = time.monotonic()
    circuit, observable = load_for_lint(code, params, language, _optional_observable(msg))
    try:
        lint_module = importlib.import_module("kernel.trainability.lint")
        lint = lint_module.lint
    except (ImportError, AttributeError) as exc:
        raise TrainabilityError("analysis_unavailable", f"Lint is not available in this kernel: {exc}") from exc
    elapsed = time.monotonic() - started
    budget = max(0.05, LINT_TIME_BUDGET_S - elapsed)
    try:
        result = lint(circuit, observable, source_lines=source_lines(circuit), time_budget_s=budget)
    except Exception as exc:
        raise normalize_error(exc) from exc
    return {"type": "trainability_lint_result", "diagnostics": result["diagnostics"], "summary": result["summary"]}


def _inspect_sync(msg: dict) -> dict[str, Any]:
    payload = inspect_code(_code(msg), _params(msg), _language(msg))
    return {"type": "trainability_inspected", **payload}


async def _run_sync(ctx: LabContext, fn, msg: dict) -> None:
    """Run a sync request off the event loop; the reply and any error echo the request's ``request_id``."""
    try:
        problem = request_id_problem(msg)
        if problem is not None:
            raise TrainabilityError("invalid_request", problem)
        response = await asyncio.to_thread(fn, msg)
    except TrainabilityError as err:
        response = error_envelope(err)
    except Exception as exc:
        response = error_envelope(normalize_error(exc))
    await ctx.send_json(with_request_id(response, msg))


# --------------------------------------------------------------------- jobs


def _build_request(msg: dict) -> dict[str, Any]:
    observable = _optional_observable(msg) or ""
    return {
        "job_id": _job_id(msg),
        "code": _code(msg),
        "language": _language(msg),
        "params": _params(msg),
        "observable": observable,
        "analyses": normalize_analyses(msg.get("analyses")),
        "settings": normalize_settings(msg.get("settings")),
    }


async def _start(msg: dict, ctx: LabContext) -> None:
    job_id = msg.get("job_id") if isinstance(msg.get("job_id"), str) else None
    try:
        request = _build_request(msg)
        get_manager().start(ctx, request)
    except TrainabilityError as err:
        await ctx.send_json(error_envelope(err, job_id))


async def _cancel(msg: dict, ctx: LabContext) -> None:
    try:
        job_id = _job_id(msg)
    except TrainabilityError as err:
        await ctx.send_json(error_envelope(err))
        return
    accepted = get_manager().cancel(ctx.owner, job_id)
    await ctx.send_json({"type": "trainability_cancelled", "job_id": job_id, "accepted": accepted})


async def handle(msg: dict, ctx: LabContext) -> None:
    """Dispatch one ``trainability_*`` message; a bad message is an error envelope, never a dropped connection."""
    try:
        await _dispatch(msg, ctx)
    except Exception as exc:  # noqa: BLE001 - last line of defence for this handler
        logger.exception("trainability handler failed for %s", msg.get("type"))
        job_id = msg.get("job_id") if isinstance(msg.get("job_id"), str) else None
        await ctx.send_json(with_request_id(error_envelope(normalize_error(exc), job_id), msg))


async def _dispatch(msg: dict, ctx: LabContext) -> None:
    msg_type = msg.get("type")
    if msg_type == "trainability_inspect":
        await _run_sync(ctx, _inspect_sync, msg)
    elif msg_type == "trainability_lint":
        await _run_sync(ctx, _lint_sync, msg)
    elif msg_type == "trainability_start":
        await _start(msg, ctx)
    elif msg_type == "trainability_cancel":
        await _cancel(msg, ctx)
    else:
        await ctx.send_json(error_envelope(
            TrainabilityError("unknown_message", f"Unknown trainability message: {msg_type}")
        ))
