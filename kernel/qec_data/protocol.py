"""Strict bounded JSON protocol for the local QEC Data Engine."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .hashing import canonical_json_bytes


MAX_FRAME_BYTES = 1_048_576
MAX_REQUEST_ID_LENGTH = 256
MAX_TEXT_LENGTH = 4_096
MAX_AUTH_TOKEN_LENGTH = 1_024
MAX_SESSION_PAGE = 100
MAX_PREVIEW_RECORDS = 1_000
MAX_JSON_DEPTH = 32


class MessageType(StrEnum):
    AUTHENTICATE = "authenticate"
    IMPORT_PROBE = "import_probe"
    IMPORT_VALIDATE = "import_validate"
    IMPORT_PREVIEW = "import_preview"
    IMPORT_START = "import_start"
    JOB_CANCEL = "job_cancel"
    QUERY_START = "query_start"
    QUERY_CANCEL = "query_cancel"
    SESSION_LIST = "session_list"


class ProtocolError(ValueError):
    """Stable client-safe protocol failure."""

    def __init__(self, code: str, message: str, request_id: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.request_id = request_id


class OutboundFrameTooLarge(ProtocolError):
    def __init__(self) -> None:
        super().__init__("frame_too_large", "Outbound frame exceeds 1 MiB.")


@dataclass(frozen=True, slots=True)
class ClientRequest:
    message_type: MessageType
    request_id: str
    _payload_json: str

    @property
    def payload(self) -> Mapping[str, Any]:
        value = _loads(self._payload_json)
        if not isinstance(value, dict):  # pragma: no cover - constructor invariant
            raise RuntimeError("request payload invariant failed")
        return value


_REQUEST_FIELDS = {
    MessageType.IMPORT_PROBE: (frozenset({"type", "requestId", "source"}), frozenset()),
    MessageType.IMPORT_VALIDATE: (
        frozenset({"type", "requestId", "source", "adapterId", "mapping"}),
        frozenset(),
    ),
    MessageType.IMPORT_PREVIEW: (
        frozenset({"type", "requestId", "source", "adapterId", "mapping", "limit"}),
        frozenset(),
    ),
    MessageType.IMPORT_START: (
        frozenset(
            {
                "type",
                "requestId",
                "source",
                "adapterId",
                "mapping",
                "sessionId",
                "sessionKind",
            }
        ),
        frozenset(),
    ),
    MessageType.JOB_CANCEL: (
        frozenset({"type", "requestId", "jobId"}),
        frozenset(),
    ),
    MessageType.QUERY_START: (
        frozenset({"type", "requestId", "query"}),
        frozenset(),
    ),
    MessageType.QUERY_CANCEL: (
        frozenset({"type", "requestId", "queryRequestId"}),
        frozenset(),
    ),
    MessageType.SESSION_LIST: (
        frozenset({"type", "requestId", "cursor", "limit"}),
        frozenset(),
    ),
}


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError("invalid_request", "Duplicate JSON keys are forbidden.")
        result[key] = value
    return result


def _reject_constant(_value: str) -> None:
    raise ProtocolError("invalid_request", "Non-finite JSON values are forbidden.")


def _loads(frame: str) -> Any:
    try:
        return json.loads(
            frame,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except ProtocolError:
        raise
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ProtocolError("invalid_request", "Frame must be strict JSON.") from error


def _frame_text(frame: object) -> str:
    if type(frame) is not str:
        raise ProtocolError("invalid_request", "Only JSON text frames are accepted.")
    if len(frame.encode("utf-8")) > MAX_FRAME_BYTES:
        raise ProtocolError("frame_too_large", "Inbound frame exceeds 1 MiB.")
    return frame


def _bounded_text(value: object, name: str, maximum: int = MAX_TEXT_LENGTH) -> str:
    if type(value) is not str or not value.strip() or len(value) > maximum:
        raise ProtocolError("invalid_request", f"{name} is invalid.")
    return value


def _validate_finite_json(value: object, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ProtocolError("invalid_request", "JSON nesting is too deep.")
    if value is None or type(value) in {str, bool, int}:
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise ProtocolError(
                "invalid_request", "Non-finite JSON values are forbidden."
            )
        return
    if type(value) is list:
        for item in value:
            _validate_finite_json(item, depth + 1)
        return
    if type(value) is dict and all(type(key) is str for key in value):
        for item in value.values():
            _validate_finite_json(item, depth + 1)
        return
    raise ProtocolError("invalid_request", "Request contains a non-JSON value.")


def parse_authentication(frame: object, expected_token: str) -> None:
    """Validate the first frame without ever reflecting the supplied secret."""

    import hmac

    try:
        value = _loads(_frame_text(frame))
        if type(value) is not dict or frozenset(value) != {"type", "token"}:
            raise ProtocolError("authentication_failed", "Authentication failed.")
        token = value["token"]
        if type(token) is not str or not 1 <= len(token) <= MAX_AUTH_TOKEN_LENGTH:
            raise ProtocolError("authentication_failed", "Authentication failed.")
        if value["type"] != MessageType.AUTHENTICATE.value:
            raise ProtocolError("authentication_failed", "Authentication failed.")
        if not hmac.compare_digest(token, expected_token):
            raise ProtocolError("authentication_failed", "Authentication failed.")
    except ProtocolError as error:
        raise ProtocolError(
            "authentication_failed", "Authentication failed."
        ) from error


def parse_request(frame: object) -> ClientRequest:
    value = _loads(_frame_text(frame))
    if type(value) is not dict:
        raise ProtocolError("invalid_request", "Request must be a JSON object.")
    request_id = _bounded_text(
        value.get("requestId"), "requestId", MAX_REQUEST_ID_LENGTH
    )
    try:
        message_type = MessageType(value.get("type"))
    except (TypeError, ValueError) as error:
        raise ProtocolError(
            "invalid_request", "Request type is not supported.", request_id
        ) from error
    if message_type is MessageType.AUTHENTICATE:
        raise ProtocolError(
            "invalid_request",
            "Authentication is only valid as the first frame.",
            request_id,
        )
    required, optional = _REQUEST_FIELDS[message_type]
    keys = frozenset(value)
    if not required <= keys <= required | optional:
        raise ProtocolError(
            "invalid_request", "Request fields are invalid.", request_id
        )
    _validate_request_values(message_type, value, request_id)
    _validate_finite_json(value)
    payload = canonical_json_bytes(value).decode("utf-8")
    return ClientRequest(message_type, request_id, payload)


def _validate_request_values(
    message_type: MessageType, value: Mapping[str, object], request_id: str
) -> None:
    try:
        if message_type in {
            MessageType.IMPORT_PROBE,
            MessageType.IMPORT_VALIDATE,
            MessageType.IMPORT_PREVIEW,
            MessageType.IMPORT_START,
        }:
            _bounded_text(value["source"], "source")
        if message_type in {
            MessageType.IMPORT_VALIDATE,
            MessageType.IMPORT_PREVIEW,
            MessageType.IMPORT_START,
        }:
            _bounded_text(value["adapterId"], "adapterId", 256)
            if type(value["mapping"]) is not dict:
                raise ProtocolError("invalid_request", "mapping must be an object.")
        if message_type is MessageType.IMPORT_PREVIEW:
            _bounded_int(value["limit"], "limit", 0, MAX_PREVIEW_RECORDS)
        if message_type is MessageType.IMPORT_START:
            _bounded_text(value["sessionId"], "sessionId", 256)
            _bounded_text(value["sessionKind"], "sessionKind", 64)
        if message_type is MessageType.JOB_CANCEL:
            _bounded_text(value["jobId"], "jobId", 256)
        if message_type is MessageType.QUERY_START and type(value["query"]) is not dict:
            raise ProtocolError("invalid_request", "query must be an object.")
        if message_type is MessageType.QUERY_CANCEL:
            _bounded_text(value["queryRequestId"], "queryRequestId", 256)
        if message_type is MessageType.SESSION_LIST:
            cursor = value["cursor"]
            if cursor is not None:
                _bounded_text(cursor, "cursor", 256)
            _bounded_int(value["limit"], "limit", 1, MAX_SESSION_PAGE)
    except ProtocolError as error:
        if error.request_id is None:
            error.request_id = request_id
        raise


def _bounded_int(value: object, name: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ProtocolError("invalid_request", f"{name} is invalid.")
    return value


def encode_frame(value: Mapping[str, object]) -> str:
    try:
        frame = canonical_json_bytes(value)
    except (TypeError, ValueError) as error:
        raise ProtocolError(
            "invalid_response", "Response is not strict JSON."
        ) from error
    if len(frame) > MAX_FRAME_BYTES:
        raise OutboundFrameTooLarge()
    return frame.decode("utf-8")


def error_frame(request_id: str | None, code: str, message: str) -> str:
    value: dict[str, object] = {"type": "error", "code": code, "message": message}
    if request_id is not None:
        value["requestId"] = request_id
    return encode_frame(value)


def query_requires_refinement_frame(request_id: str) -> str:
    return error_frame(
        request_id,
        "query_requires_refinement",
        "Query result exceeds the 1 MiB frame limit; refine or paginate it.",
    )
