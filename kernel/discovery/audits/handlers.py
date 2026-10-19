"""Websocket handlers for Red Queen audits (addendum section F).

Routed from ``kernel/discovery/handlers.py`` for every ``discovery_audit*`` message::

    discovery_audit        {run_id, candidate_id, evaluator: {kind, config}, program, entry?, seed, evaluation}
      -> discovery_audit_accepted {run_id, candidate_id, queue_position}
      -> discovery_audit_result   {run_id, candidate_id, audit}      (later)
    discovery_audit_cancel {run_id, candidate_id?}
      -> discovery_audit_cancelled {run_id, candidate_id, cancelled}

Failures use the discovery error envelope.
"""

from __future__ import annotations

from typing import Any

from kernel.discovery.audits import has_audit
from kernel.discovery.audits.runner import AuditRequest, BusyError, get_audit_manager
from kernel.discovery.constants import (
    ERR_BUSY, ERR_INVALID_CONFIG, ERR_INVALID_REQUEST, ERR_UNKNOWN_EVALUATOR,
)
from kernel.discovery.evaluators import EVALUATORS, InvalidConfig, normalize_config
from kernel.discovery.handlers import (
    RequestError, _error, _IDENT, _integer, _program, _text, require_evaluator_available,
)

ERR_AUDIT_UNAVAILABLE = "audit_unavailable"
_EVALUATION_STATUSES = ("scored", "rejected", "failed")


def parse_audit(msg: dict[str, Any]) -> AuditRequest:
    run_id = _text(msg, "run_id")
    candidate_id = _text(msg, "candidate_id")
    evaluator = msg.get("evaluator")
    if not isinstance(evaluator, dict) or not isinstance(evaluator.get("kind"), str):
        raise RequestError(ERR_INVALID_REQUEST, "'evaluator' must be an object with a 'kind'.")
    spec = EVALUATORS.get(evaluator["kind"])
    if spec is None:
        raise RequestError(ERR_UNKNOWN_EVALUATOR, f"Unknown evaluator '{evaluator['kind']}'.")
    require_evaluator_available(spec.kind)  # an audit re-runs the evaluator's toolchain
    if not has_audit(spec.kind):
        raise RequestError(ERR_AUDIT_UNAVAILABLE, f"No audit exists for evaluator '{spec.kind}'.")
    try:
        config = normalize_config(spec, evaluator.get("config"))
    except InvalidConfig as exc:
        raise RequestError(ERR_INVALID_CONFIG, str(exc)) from exc
    entry = msg.get("entry") or spec.default_entry
    if not isinstance(entry, str) or not _IDENT.match(entry):
        raise RequestError(ERR_INVALID_REQUEST, "'entry' must be a Python identifier.")
    evaluation = msg.get("evaluation")
    if not isinstance(evaluation, dict) or evaluation.get("status") not in _EVALUATION_STATUSES:
        raise RequestError(ERR_INVALID_REQUEST, "'evaluation' must be an evaluation record with a valid 'status'.")
    return AuditRequest(run_id, candidate_id, spec.kind, config, _program(msg), entry, _integer(msg, "seed"), evaluation)


async def _audit(msg: dict[str, Any], ctx) -> None:
    request = parse_audit(msg)
    manager = get_audit_manager()
    try:
        job, position = manager.enqueue(ctx.owner, request, ctx.emit_threadsafe)
    except BusyError as exc:
        await ctx.send_json(_error(ERR_BUSY, str(exc), msg))
        return
    await ctx.send_json({
        "type": "discovery_audit_accepted", "run_id": request.run_id,
        "candidate_id": request.candidate_id, "queue_position": position,
    })
    manager.launch(job)


async def _cancel(msg: dict[str, Any], ctx) -> None:
    run_id = _text(msg, "run_id")
    candidate_id = _text(msg, "candidate_id", required=False)
    cancelled = get_audit_manager().cancel(ctx.owner, run_id, candidate_id)
    await ctx.send_json({
        "type": "discovery_audit_cancelled", "run_id": run_id, "candidate_id": candidate_id, "cancelled": cancelled,
    })


async def handle(msg: dict[str, Any], ctx) -> None:
    """Dispatch one ``discovery_audit*`` message (errors become discovery envelopes)."""
    manager = get_audit_manager()
    ctx.on_release("discovery_audit", lambda owner=ctx.owner: manager.release_owner(owner))
    msg_type = msg.get("type")
    try:
        if msg_type == "discovery_audit":
            await _audit(msg, ctx)
        elif msg_type == "discovery_audit_cancel":
            await _cancel(msg, ctx)
        else:
            await ctx.send_json(_error(ERR_INVALID_REQUEST, f"Unknown discovery message '{msg_type}'.", msg))
    except RequestError as exc:
        await ctx.send_json(_error(exc.code, exc.message, msg, exc.extra))
    except Exception as exc:  # noqa: BLE001 - the connection must survive a handler bug
        await ctx.send_json(_error("discovery_internal", f"{type(exc).__name__}: {exc}", msg))
