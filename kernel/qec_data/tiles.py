"""Immutable bounded QEC tile events and their single wire serializer."""

from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .hashing import canonical_json_bytes
from .model_codecs import loads_canonical_json


MAX_QUERY_EVENT_BYTES = 1_048_576
MAX_TILE_SEQUENCE = 2**53 - 1
TILE_KINDS = frozenset(
    {
        "time-series",
        "heatmap",
        "histogram",
        "graph-overlay",
        "shot-window",
        "table-page",
    }
)
_QUERY_TILE_TOKEN = object()
ENTITY_KINDS = frozenset(
    {
        "study",
        "source",
        "session",
        "dataset",
        "circuit-revision",
        "tick",
        "qubit",
        "stabilizer",
        "detector",
        "edge",
        "logical-observable",
        "campaign-point",
        "decoder",
        "shot",
        "round",
        "time-window",
        "calibration-record",
        "cohort",
        "alert",
        "finding",
    }
)


class QuerySerializationError(ValueError):
    """A query event cannot be represented as strict bounded JSON."""


class QueryRequiresRefinement(QuerySerializationError):
    """The requested tile cannot fit in one bounded browser event."""


@dataclass(frozen=True, slots=True)
class QecTilePayload:
    kind: str
    dataset_id: str
    sequence: int
    content_json: str
    byte_length: int

    @property
    def content(self) -> Mapping[str, Any]:
        value = loads_canonical_json(self.content_json)
        if not isinstance(value, dict):
            raise QuerySerializationError("tile content must be an object")
        return value

    def to_wire(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "datasetId": self.dataset_id,
            "sequence": self.sequence,
            "content": dict(self.content),
            "byteLength": self.byte_length,
        }


@dataclass(frozen=True, slots=True)
class QueryProgress:
    request_id: str
    fraction: float
    stage: str

    def to_wire(self) -> dict[str, object]:
        return {
            "type": "progress",
            "requestId": self.request_id,
            "fraction": self.fraction,
            "message": self.stage,
        }


@dataclass(frozen=True, slots=True)
class QueryTile:
    request_id: str
    tile: QecTilePayload
    complete: bool
    frame: bytes
    _token: object = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._token is not _QUERY_TILE_TOKEN or type(self.frame) is not bytes:
            raise TypeError("query tiles must be created by make_query_tile")

    def to_wire(self) -> dict[str, object]:
        return {
            "type": "tile",
            "requestId": self.request_id,
            "tile": self.tile.to_wire(),
            "complete": self.complete,
        }


QueryEvent = QueryProgress | QueryTile


def encode_binary(value: bytes) -> str:
    if type(value) is not bytes:
        raise QuerySerializationError("binary tile values must be bytes")
    return base64.b64encode(value).decode("ascii")


def validate_selection(value: object) -> Mapping[str, Any]:
    keys = frozenset({"primary", "scope", "timeWindow", "source"})
    if not isinstance(value, Mapping) or frozenset(value) != keys:
        raise QuerySerializationError("selection fields are invalid")
    if value["source"] not in {"user", "panel", "alert", "dirac", "restore"}:
        raise QuerySerializationError("selection source is invalid")
    primary = value["primary"]
    if primary is not None:
        _validate_entity_ref(primary)
    scope = value["scope"]
    if not isinstance(scope, list) or len(scope) > 10_000:
        raise QuerySerializationError("selection scope is invalid")
    for item in scope:
        _validate_entity_ref(item)
    _validate_time_window(value["timeWindow"])
    _strict_json(value, "selection")
    return value


def _validate_entity_ref(value: object) -> None:
    required = frozenset({"kind", "id"})
    allowed = required | frozenset({"sessionId", "datasetId"})
    if not isinstance(value, Mapping):
        raise QuerySerializationError("selection entity must be an object")
    keys = frozenset(value)
    if not required <= keys <= allowed or value["kind"] not in ENTITY_KINDS:
        raise QuerySerializationError("selection entity fields are invalid")
    if any(not isinstance(value[key], str) or not value[key] for key in keys):
        raise QuerySerializationError("selection entity values are invalid")


def _validate_time_window(value: object) -> None:
    if value is None:
        return
    keys = frozenset({"start", "end", "domain"})
    if not isinstance(value, Mapping) or frozenset(value) != keys:
        raise QuerySerializationError("selection time window is invalid")
    start, end = value["start"], value["end"]
    if not isinstance(start, (int, float)) or isinstance(start, bool):
        raise QuerySerializationError("selection time window start is invalid")
    if not isinstance(end, (int, float)) or isinstance(end, bool) or end < start:
        raise QuerySerializationError("selection time window end is invalid")
    if value["domain"] not in {"tick", "round", "ns"}:
        raise QuerySerializationError("selection time window domain is invalid")
    _strict_json(value, "selection time window")


def make_query_tile(
    request_id: str,
    dataset_id: str,
    kind: str,
    content: Mapping[str, object],
    *,
    sequence: int = 0,
    complete: bool = True,
) -> QueryTile:
    _validate_identity(request_id, dataset_id, kind, sequence)
    content_json = _strict_json(content, "tile content").decode("utf-8")
    byte_length = _tile_byte_length(kind, dataset_id, sequence, content_json)
    payload = QecTilePayload(kind, dataset_id, sequence, content_json, byte_length)
    wire = {
        "type": "tile",
        "requestId": request_id,
        "tile": payload.to_wire(),
        "complete": complete,
    }
    frame = _strict_json(wire, "query event")
    if len(frame) > MAX_QUERY_EVENT_BYTES:
        raise QueryRequiresRefinement(
            "query requires refinement to fit the 1 MiB event limit"
        )
    return QueryTile(request_id, payload, complete, frame, _QUERY_TILE_TOKEN)


def serialize_query_event(event: QueryEvent) -> bytes:
    if isinstance(event, QueryTile):
        if len(event.frame) > MAX_QUERY_EVENT_BYTES:
            raise QueryRequiresRefinement("query event exceeds the 1 MiB limit")
        return event.frame
    frame = _strict_json(event.to_wire(), "query event")
    if len(frame) > MAX_QUERY_EVENT_BYTES:
        raise QueryRequiresRefinement("query event exceeds the 1 MiB limit")
    return frame


def _validate_identity(
    request_id: str, dataset_id: str, kind: str, sequence: int
) -> None:
    if not isinstance(request_id, str) or not request_id or len(request_id) > 256:
        raise QuerySerializationError("query request ID is invalid")
    if not isinstance(dataset_id, str) or not dataset_id or len(dataset_id) > 256:
        raise QuerySerializationError("query dataset ID is invalid")
    if kind not in TILE_KINDS:
        raise QuerySerializationError("query tile kind is invalid")
    if not isinstance(sequence, int) or isinstance(sequence, bool):
        raise QuerySerializationError("tile sequence must be an integer")
    if not 0 <= sequence <= MAX_TILE_SEQUENCE:
        raise QuerySerializationError("tile sequence is outside the safe range")


def _strict_json(value: object, name: str) -> bytes:
    try:
        return canonical_json_bytes(value)
    except (TypeError, ValueError) as error:
        raise QuerySerializationError(f"{name} is not strict finite JSON") from error


def _tile_byte_length(
    kind: str, dataset_id: str, sequence: int, content_json: str
) -> int:
    content = loads_canonical_json(content_json)
    byte_length = 0
    for _ in range(8):
        wire = {
            "kind": kind,
            "datasetId": dataset_id,
            "sequence": sequence,
            "content": content,
            "byteLength": byte_length,
        }
        measured = len(_strict_json(wire, "tile payload"))
        if measured == byte_length:
            return measured
        byte_length = measured
    raise QuerySerializationError("tile payload byte length did not converge")
