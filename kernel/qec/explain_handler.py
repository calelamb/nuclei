"""WebSocket handler for the ``qec_explain`` kernel message.

Request::

    {"type": "qec_explain", "circuit_text": "<.stim text>",
     "analysis": "both" | "nondeterministic" | "min_weight", "request_id": "..."}

Reply (one message)::

    {"type": "qec_explain_result", "request_id": ..., "data": {
        "nondeterministic": {...} | absent, "min_weight": {...} | absent}}

or a visible ``error`` message with ``phase: "qec_explain"``. The analyses are
static (circuit text only); the handler never touches sampled data.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

# The WebSocket server closes the connection above 1 MiB (server.MAX_MESSAGE_SIZE),
# so a bigger circuit could never arrive. Keep a margin for the JSON envelope.
MAX_CIRCUIT_BYTES = 1_000_000
ANALYSES = ("both", "nondeterministic", "min_weight")
PHASE = "qec_explain"


def _error(message: str, code: str, request_id: Any, **extra: Any) -> str:
    payload = {"type": "error", "message": message, "code": code, "phase": PHASE}
    if request_id is not None:
        payload["request_id"] = request_id
    return json.dumps({**payload, **extra})


def _run(circuit_text: str, analysis: str) -> dict[str, Any]:
    # Imported here, not at module top: stim is an optional dependency, and an
    # ImportError must reach handle_qec_explain's visible-error path instead of
    # escaping the server's routing branch and killing the connection.
    from kernel.qec.explain import explain_nondeterministic, min_weight_logical_error

    data: dict[str, Any] = {}
    if analysis in ("both", "nondeterministic"):
        data["nondeterministic"] = explain_nondeterministic(circuit_text)
    if analysis in ("both", "min_weight"):
        data["min_weight"] = min_weight_logical_error(circuit_text)
    return data


async def handle_qec_explain(websocket: Any, msg: dict[str, Any]) -> None:
    request_id = msg.get("request_id") if isinstance(msg.get("request_id"), str) else None
    circuit_text = msg.get("circuit_text")
    analysis = msg.get("analysis", "both")
    if not isinstance(circuit_text, str) or not circuit_text.strip():
        await websocket.send(_error(
            "qec_explain needs the Stim circuit text to analyse; none was provided.",
            "qec_explain_invalid", request_id))
        return
    if len(circuit_text.encode("utf-8")) > MAX_CIRCUIT_BYTES:
        await websocket.send(_error(
            f"This circuit is larger than {MAX_CIRCUIT_BYTES:,} bytes, too large to explain.",
            "qec_explain_too_large", request_id))
        return
    if analysis not in ANALYSES:
        await websocket.send(_error(
            f"Unknown analysis '{analysis}'. Use one of: {', '.join(ANALYSES)}.",
            "qec_explain_invalid", request_id))
        return
    try:
        data = await asyncio.to_thread(_run, circuit_text, analysis)
    except ImportError:
        await websocket.send(_error(
            "Stim is not installed, so circuits cannot be explained in this environment.",
            "missing_dependency", request_id, framework="stim", dependency="stim"))
        return
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the UI, never swallowed
        await websocket.send(_error(
            f"Explaining this circuit failed: {type(exc).__name__}: {exc}",
            "qec_explain_failed", request_id))
        return
    reply = {"type": "qec_explain_result", "data": data}
    if request_id is not None:
        reply["request_id"] = request_id
    await websocket.send(json.dumps(reply))
