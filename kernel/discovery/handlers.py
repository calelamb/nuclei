"""Websocket handlers for the Discovery Engine (protocol v1.3, PRD 14 spec 6.6).

``handle(msg, ctx)`` is routed from ``kernel/server.py``. Every failure is an
``{"type": "error", "phase": "discovery", "code", "message", ...}`` envelope.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from kernel.discovery.cache import ProgramSyntaxError, strict_program_key
from kernel.discovery.constants import (
    DEFAULT_STAGE,
    ERR_BUSY,
    ERR_INVALID_CONFIG,
    ERR_INVALID_REQUEST,
    ERR_UNKNOWN_EVALUATOR,
    VALID_STAGES,
)
from kernel.discovery._optional import missing_message
from kernel.discovery.evaluators import (
    ERR_MISSING_DEPENDENCY,
    EVALUATORS,
    InvalidConfig,
    describe,
    error_fields,
    missing_for,
    normalize_config,
)
from kernel.discovery.manager import BusyError, ConsentRequiredError, EvaluateRequest, get_manager
from kernel.discovery.mutate import MutationError, mutate
from kernel.lab_protocol import request_id_problem, with_request_id

ERR_CONSENT_REQUIRED = "isolation_consent_required"
VALID_ORIGINS = ("claude", "ast", "symmetry", "user")
MAX_PROGRAM_BYTES = 400_000
MAX_MUTATIONS = 64
MAX_ID_LENGTH = 200
# run_id / candidate_id become file names and cache keys on the frontend (RT-L2); `~` is
# allowed because confirmation candidates look like `c-0007~confirm0`.
_ID_RE = re.compile(r"^[A-Za-z0-9._~-]{1,200}$")
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class RequestError(Exception):
    def __init__(self, code: str, message: str, extra: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra or {}


def require_evaluator_available(kind: str) -> None:
    """Fail fast with ``missing_dependency`` when an evaluator's optional packages are absent."""
    absent = missing_for(kind)
    if absent:
        raise RequestError(ERR_MISSING_DEPENDENCY, missing_message(absent), error_fields(absent))


def _error(
    code: str, message: str, msg: dict[str, Any] | None = None, extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"type": "error", "phase": "discovery", "code": code, "message": message}
    payload.update(extra or {})
    for key in ("run_id", "candidate_id"):
        value = (msg or {}).get(key)
        if isinstance(value, str) and _ID_RE.match(value):
            payload[key] = value
    return with_request_id(payload, msg)


#: Sync requests that may carry an optional ``request_id`` (echoed on the reply and on errors).
SYNC_TYPES = ("discovery_evaluators", "discovery_mutate", "discovery_program_key", "discovery_conjecture_schema")


def _text(msg: dict[str, Any], key: str, *, required: bool = True) -> str | None:
    """A run/candidate id: ``[A-Za-z0-9._~-]{1,200}``; anything else is ``invalid_request``."""
    value = msg.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not _ID_RE.match(value):
        raise RequestError(
            ERR_INVALID_REQUEST,
            f"'{key}' must match [A-Za-z0-9._~-] and be 1-{MAX_ID_LENGTH} characters long.",
        )
    return value


def _integer(msg: dict[str, Any], key: str) -> int:
    value = msg.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < 2**63:
        raise RequestError(ERR_INVALID_REQUEST, f"'{key}' must be a non-negative integer.")
    return value


def _program(msg: dict[str, Any]) -> str:
    program = msg.get("program")
    if not isinstance(program, str) or not program.strip():
        raise RequestError(ERR_INVALID_REQUEST, "'program' must be a non-empty string.")
    if len(program.encode("utf-8")) > MAX_PROGRAM_BYTES:
        raise RequestError(ERR_INVALID_REQUEST, f"'program' exceeds {MAX_PROGRAM_BYTES} bytes.")
    return program


def parse_evaluate(msg: dict[str, Any]) -> EvaluateRequest:
    run_id = _text(msg, "run_id")
    candidate_id = _text(msg, "candidate_id")
    evaluator = msg.get("evaluator")
    if not isinstance(evaluator, dict) or not isinstance(evaluator.get("kind"), str):
        raise RequestError(ERR_INVALID_REQUEST, "'evaluator' must be an object with a 'kind'.")
    spec = EVALUATORS.get(evaluator["kind"])
    if spec is None:
        raise RequestError(ERR_UNKNOWN_EVALUATOR, f"Unknown evaluator '{evaluator['kind']}'.")
    require_evaluator_available(spec.kind)
    try:
        config = normalize_config(spec, evaluator.get("config"))
    except InvalidConfig as exc:
        raise RequestError(ERR_INVALID_CONFIG, str(exc)) from exc
    program = _program(msg)
    entry = msg.get("entry") or spec.default_entry
    if not isinstance(entry, str) or not _IDENT.match(entry):
        raise RequestError(ERR_INVALID_REQUEST, "'entry' must be a Python identifier.")
    stage = msg.get("stage") or DEFAULT_STAGE
    if stage not in VALID_STAGES:
        raise RequestError(ERR_INVALID_REQUEST, f"'stage' must be one of {list(VALID_STAGES)}.")
    return EvaluateRequest(
        run_id, candidate_id, spec.kind, config, program, entry, _integer(msg, "seed"), stage,
        isolation_consent=_consent(msg), origin=_origin(msg),
    )


def _consent(msg: dict[str, Any]) -> bool:
    value = msg.get("isolation_consent", False)
    if not isinstance(value, bool):
        raise RequestError(ERR_INVALID_REQUEST, "'isolation_consent' must be a boolean.")
    return value


def _origin(msg: dict[str, Any]) -> str | None:
    value = msg.get("origin")
    if value is None:
        return None
    if value not in VALID_ORIGINS:
        raise RequestError(ERR_INVALID_REQUEST, f"'origin' must be one of {list(VALID_ORIGINS)}.")
    return value


async def _evaluate(msg: dict[str, Any], ctx) -> None:
    request = parse_evaluate(msg)
    manager = get_manager()
    try:
        # The first call probes the host (a worker run through each wrapper), so keep it off the loop.
        await asyncio.to_thread(manager.check_consent, request)
    except ConsentRequiredError as exc:
        raise RequestError(
            ERR_CONSENT_REQUIRED, exc.capability_text, {"capability_text": exc.capability_text, "isolation": "process"},
        ) from exc
    try:
        job, position = manager.enqueue(ctx.owner, request, ctx.emit_threadsafe)
    except BusyError as exc:
        await ctx.send_json(_error(ERR_BUSY, str(exc), msg))
        return
    await ctx.send_json({
        "type": "discovery_evaluate_accepted",
        "run_id": request.run_id,
        "candidate_id": request.candidate_id,
        "queue_position": position,
    })
    manager.launch(job)


async def _cancel(msg: dict[str, Any], ctx) -> None:
    run_id = _text(msg, "run_id")
    candidate_id = _text(msg, "candidate_id", required=False)
    cancelled = get_manager().cancel(ctx.owner, run_id, candidate_id)
    await ctx.send_json({
        "type": "discovery_cancelled", "run_id": run_id, "candidate_id": candidate_id, "cancelled": cancelled,
    })


async def _mutate(msg: dict[str, Any], ctx) -> None:
    program = _program(msg)
    seed = _integer(msg, "seed")
    count = msg.get("count", 1)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_MUTATIONS:
        raise RequestError(ERR_INVALID_REQUEST, f"'count' must be an integer between 1 and {MAX_MUTATIONS}.")
    markers = {k: msg.get(k) for k in ("start_marker", "end_marker")}
    for key, value in markers.items():
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise RequestError(ERR_INVALID_REQUEST, f"'{key}' must be a non-empty string.")
    try:
        mutations = await asyncio.to_thread(
            mutate, program, start_marker=markers["start_marker"], end_marker=markers["end_marker"],
            seed=seed, count=count,
        )
    except MutationError as exc:
        raise RequestError("mutation_failed", str(exc)) from exc
    await ctx.send_json(with_request_id({"type": "discovery_mutations", "mutations": mutations}, msg))


async def _program_key(msg: dict[str, Any], ctx) -> None:
    """``discovery_program_key {program}`` -> ``{program_key}``: the cache's normalized-AST hash, without evaluating."""
    program = _program(msg)
    try:
        key = await asyncio.to_thread(strict_program_key, program)
    except ProgramSyntaxError as exc:
        raise RequestError("invalid_program", f"The program has a syntax error: {exc}") from exc
    await ctx.send_json(with_request_id({"type": "discovery_program_key_result", "program_key": key}, msg))


async def handle(msg: dict[str, Any], ctx) -> None:
    """Dispatch one ``discovery_*`` message."""
    manager = get_manager()
    ctx.on_release("discovery", lambda owner=ctx.owner: manager.release_owner(owner))
    msg_type = msg.get("type")
    try:
        problem = request_id_problem(msg) if msg_type in SYNC_TYPES else None
        if problem is not None:
            raise RequestError(ERR_INVALID_REQUEST, problem)
        if msg_type == "discovery_evaluators":
            await ctx.send_json(with_request_id({
                "type": "discovery_evaluators_result",
                "evaluators": [describe(spec) for spec in EVALUATORS.values()],
            }, msg))
        elif msg_type == "discovery_evaluate":
            await _evaluate(msg, ctx)
        elif msg_type == "discovery_cancel":
            await _cancel(msg, ctx)
        elif msg_type == "discovery_mutate":
            await _mutate(msg, ctx)
        elif msg_type == "discovery_program_key":
            await _program_key(msg, ctx)
        elif isinstance(msg_type, str) and msg_type.startswith("discovery_audit"):
            # Red Queen mode (addendum §F): independent audits of scored artifacts.
            from kernel.discovery.audits.handlers import handle as handle_audit
            await handle_audit(msg, ctx)
        elif isinstance(msg_type, str) and msg_type.startswith("discovery_conjecture"):
            # Conjecture Engine (addendum §G): held-out tests of proposed conjectures.
            from kernel.discovery.conjecture.handlers import handle as handle_conjecture
            await handle_conjecture(msg, ctx)
        else:
            await ctx.send_json(_error(ERR_INVALID_REQUEST, f"Unknown discovery message '{msg_type}'.", msg))
    except RequestError as exc:
        await ctx.send_json(_error(exc.code, exc.message, msg, exc.extra))
    except Exception as exc:  # noqa: BLE001 - the connection must survive a handler bug
        await ctx.send_json(_error("discovery_internal", f"{type(exc).__name__}: {exc}", msg))
