from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal

PROTOCOL_VERSION = 1
MAX_REQUEST_BYTES = 270_000
MAX_CODE_BYTES = 256 * 1024
MAX_SHOTS = 10_000

_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_ALLOWED_FIELDS = {
    "protocol_version",
    "request_id",
    "action",
    "framework",
    "language",
    "code",
    "shots",
}
_REQUIRED_FIELDS = _ALLOWED_FIELDS - {"shots"}


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class AgentRequest:
    request_id: str
    action: Literal["parse", "simulate"]
    framework: Literal["qiskit", "cirq", "qsharp"]
    language: Literal["python", "qsharp"]
    code: str
    shots: int | None


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def parse_request(raw: bytes) -> AgentRequest:
    if len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError("request_too_large")

    try:
        value = json.loads(raw, parse_constant=_reject_json_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ProtocolError("malformed_json") from exc

    if not isinstance(value, dict):
        raise ProtocolError("request_must_be_object")
    if set(value) - _ALLOWED_FIELDS:
        raise ProtocolError("unknown_field")
    if not _REQUIRED_FIELDS <= set(value):
        raise ProtocolError("missing_field")
    if type(value["protocol_version"]) is not int or value["protocol_version"] != PROTOCOL_VERSION:
        raise ProtocolError("unsupported_version")

    request_id = value["request_id"]
    action = value["action"]
    framework = value["framework"]
    language = value["language"]
    code = value["code"]
    shots = value.get("shots")

    if not isinstance(request_id, str) or _REQUEST_ID.fullmatch(request_id) is None:
        raise ProtocolError("invalid_request_id")
    if not isinstance(action, str) or action not in {"parse", "simulate"}:
        raise ProtocolError("invalid_action")
    if not isinstance(framework, str) or framework not in {"qiskit", "cirq", "qsharp"}:
        raise ProtocolError("framework_unavailable")
    if language != ("qsharp" if framework == "qsharp" else "python"):
        raise ProtocolError("framework_language_mismatch")
    if not isinstance(code, str):
        raise ProtocolError("invalid_code")
    try:
        code_bytes = code.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ProtocolError("invalid_code") from exc
    if len(code_bytes) > MAX_CODE_BYTES:
        raise ProtocolError("code_too_large")
    if action == "parse" and "shots" in value:
        raise ProtocolError("parse_forbids_shots")
    if action == "simulate" and (type(shots) is not int or not 1 <= shots <= MAX_SHOTS):
        raise ProtocolError("invalid_shots")

    return AgentRequest(request_id, action, framework, language, code, shots)


def response_bytes(
    request_id: str,
    status: Literal["ok", "error"],
    snapshot: dict[str, Any] | None,
    result: dict[str, Any] | None,
    stdout: str,
    stderr: str,
    error: dict[str, Any] | None,
) -> bytes:
    value = {
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request_id,
        "status": status,
        "snapshot": snapshot,
        "result": result,
        "stdout": stdout,
        "stderr": stderr,
        "error": error,
    }
    return json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"
