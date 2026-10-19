"""Websocket handlers for the Conjecture Engine (protocol v1.3 additive, addendum section G).

Routed from ``kernel/discovery/handlers.py`` for every ``discovery_conjecture*`` message::

    discovery_conjecture_test {job_id, conjecture, seed?}
      -> discovery_conjecture_started {job_id}
      -> discovery_conjecture_progress {job_id, fraction, message, circuit_index}   (<= 10/s)
      -> discovery_conjecture_evidence {job_id, item}                                (one per circuit)
      -> discovery_conjecture_result {job_id, status: complete|cancelled|failed, result, error?}
    discovery_conjecture_cancel {job_id} -> discovery_conjecture_cancelled {job_id, accepted}
    discovery_conjecture_schema {request_id?} -> discovery_conjecture_schema_result {features, quantities, families, predicate, limits, request_id?}

Errors use the discovery envelope: ``{"type": "error", "phase": "discovery", "code", "message", "job_id"?, "path"?}``
with codes ``invalid_conjecture`` (carries ``path``), ``conjecture_busy``, ``conjecture_internal`` and
``invalid_request``.
"""

from __future__ import annotations

from typing import Any

from kernel.discovery.conjecture.errors import SpecError
from kernel.discovery.conjecture.jobs import ConjectureJobError, get_manager
from kernel.discovery.conjecture.spec import schema_payload, validate_conjecture
from kernel.lab_protocol import request_id_problem, with_request_id

MAX_ID_LENGTH = 200


def _error(code: str, message: str, msg: dict[str, Any], path: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"type": "error", "phase": "discovery", "code": code, "message": message}
    job_id = msg.get("job_id")
    if isinstance(job_id, str) and job_id:
        payload["job_id"] = job_id[:MAX_ID_LENGTH]
    if path is not None:
        payload["path"] = path
    return with_request_id(payload, msg)


def _job_id(msg: dict[str, Any]) -> str | None:
    job_id = msg.get("job_id")
    ok = isinstance(job_id, str) and 0 < len(job_id) <= MAX_ID_LENGTH
    return job_id if ok else None


async def _test(msg: dict[str, Any], ctx) -> None:
    job_id = _job_id(msg)
    seed = msg.get("seed", 0)
    if job_id is None or isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**31:
        await ctx.send_json(_error("invalid_request", "'job_id' must be a non-empty string and 'seed' an integer "
                                   "between 0 and 2^31 - 1.", msg))
        return
    try:
        validate_conjecture(msg.get("conjecture"))
    except SpecError as exc:
        await ctx.send_json(_error("invalid_conjecture", exc.message, msg, exc.path))
        return
    try:
        get_manager().start(ctx, job_id, msg["conjecture"], seed)
    except ConjectureJobError as exc:
        await ctx.send_json(_error(exc.code, exc.message, msg))


async def handle(msg: dict[str, Any], ctx) -> None:
    """Dispatch one ``discovery_conjecture*`` message."""
    msg_type = msg.get("type")
    try:
        if msg_type == "discovery_conjecture_test":
            await _test(msg, ctx)
        elif msg_type == "discovery_conjecture_cancel":
            job_id = _job_id(msg)
            if job_id is None:
                await ctx.send_json(_error("invalid_request", "'job_id' must be a non-empty string.", msg))
                return
            accepted = get_manager().cancel(ctx.owner, job_id)
            await ctx.send_json({"type": "discovery_conjecture_cancelled", "job_id": job_id, "accepted": accepted})
        elif msg_type == "discovery_conjecture_schema":
            problem = request_id_problem(msg)
            if problem is not None:
                await ctx.send_json(_error("invalid_request", problem, msg))
                return
            await ctx.send_json(with_request_id({"type": "discovery_conjecture_schema_result", **schema_payload()}, msg))
        else:
            await ctx.send_json(_error("invalid_request", f"Unknown conjecture message '{msg_type}'.", msg))
    except Exception as exc:  # noqa: BLE001 - the connection must survive a handler bug
        await ctx.send_json(_error("conjecture_internal", f"{type(exc).__name__}: {exc}", msg))
