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
    "basis_gates",
    "coupling_map",
    "optimization_level",
}
_TRANSPILE_ONLY_FIELDS = {"basis_gates", "coupling_map", "optimization_level"}
_REQUIRED_FIELDS = _ALLOWED_FIELDS - {"shots"} - _TRANSPILE_ONLY_FIELDS


class ProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class AgentRequest:
    request_id: str
    action: Literal["parse", "simulate", "transpile", "transpile_explore"]
    framework: Literal["qiskit", "cirq", "qsharp"]
    language: Literal["python", "qsharp"]
    code: str
    shots: int | None
    basis_gates: list[str] | None = None
    coupling_map: list[list[int]] | None = None
    optimization_level: int | None = None


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON object key: {key}")
        value[key] = item
    return value


def _validate_basis_gates(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, list) or not all(isinstance(g, str) for g in value):
        raise ProtocolError("invalid_basis_gates")


def _validate_coupling_map(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, list):
        raise ProtocolError("invalid_coupling_map")
    for pair in value:
        if (
            not isinstance(pair, list)
            or len(pair) != 2
            or not all(type(x) is int for x in pair)
        ):
            raise ProtocolError("invalid_coupling_map")


def _validate_optimization_level(value: Any) -> None:
    if value is None:
        return
    if type(value) is not int or not 0 <= value <= 3:
        raise ProtocolError("invalid_optimization_level")


def parse_request(raw: bytes) -> AgentRequest:
    if len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError("request_too_large")

    try:
        text = raw.decode("utf-8")
        value = json.loads(
            text,
            parse_constant=_reject_json_constant,
            object_pairs_hook=_strict_object,
        )
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
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
    basis_gates = value.get("basis_gates")
    coupling_map = value.get("coupling_map")
    optimization_level = value.get("optimization_level")

    if not isinstance(request_id, str) or _REQUEST_ID.fullmatch(request_id) is None:
        raise ProtocolError("invalid_request_id")
    if not isinstance(action, str) or action not in {
        "parse",
        "simulate",
        "transpile",
        "transpile_explore",
    }:
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
    is_transpile = action in {"transpile", "transpile_explore"}
    if is_transpile and "shots" in value:
        raise ProtocolError("transpile_forbids_shots")
    if action == "simulate" and (type(shots) is not int or not 1 <= shots <= MAX_SHOTS):
        raise ProtocolError("invalid_shots")
    if is_transpile:
        if framework != "qiskit":
            raise ProtocolError("transpile_requires_qiskit")
        _validate_basis_gates(basis_gates)
        _validate_coupling_map(coupling_map)
        _validate_optimization_level(optimization_level)
    elif _TRANSPILE_ONLY_FIELDS & set(value):
        raise ProtocolError("transpile_fields_forbidden")

    return AgentRequest(
        request_id,
        action,
        framework,
        language,
        code,
        shots,
        basis_gates,
        coupling_map,
        optimization_level,
    )


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
