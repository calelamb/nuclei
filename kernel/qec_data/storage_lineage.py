"""Record-kind and source-lineage primitives for durable QEC storage."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from .adapters.base import SourceSpan, SourceSpanPrecision
from .hashing import canonical_json_bytes
from .model_codecs import loads_canonical_json
from .models import (
    CalibrationBatch,
    CampaignPointBatch,
    IndexRange,
    SyndromeBatch,
)


SYNDROMES = "syndromes"
CAMPAIGN_POINTS = "campaign_points"
CALIBRATIONS = "calibrations"
RECORD_KINDS = frozenset({SYNDROMES, CAMPAIGN_POINTS, CALIBRATIONS})
MAX_SOURCE_SPANS = 1_024
MAX_SOURCE_SPANS_BYTES = 65_536


@dataclass(frozen=True, slots=True, order=True)
class SegmentKey:
    record_kind: str
    segment_id: str

    def __post_init__(self) -> None:
        if self.record_kind not in RECORD_KINDS:
            raise ValueError("record kind is unsupported")
        if not isinstance(self.segment_id, str) or not self.segment_id:
            raise ValueError("segment ID must be nonempty")


def payload_kind(payload: object) -> str:
    kinds = {
        SyndromeBatch: SYNDROMES,
        CampaignPointBatch: CAMPAIGN_POINTS,
        CalibrationBatch: CALIBRATIONS,
    }
    try:
        return kinds[type(payload)]
    except KeyError as error:
        raise TypeError("payload is not a canonical QEC batch") from error


def source_spans_to_value(spans: tuple[SourceSpan, ...]) -> list[dict[str, object]]:
    _validate_spans(spans)
    return [
        {
            "source_id": span.source_id,
            "byte_ranges": [_range_to_value(item) for item in span.byte_ranges],
            "row_range": (
                None if span.row_range is None else _range_to_value(span.row_range)
            ),
            "precision": span.precision.value,
        }
        for span in spans
    ]


def source_spans_to_bytes(spans: tuple[SourceSpan, ...]) -> bytes:
    encoded = canonical_json_bytes(source_spans_to_value(spans))
    if len(encoded) > MAX_SOURCE_SPANS_BYTES:
        raise ValueError("source span metadata exceeds 64 KiB")
    return encoded


def source_spans_from_value(value: object) -> tuple[SourceSpan, ...]:
    if not isinstance(value, list) or len(value) > MAX_SOURCE_SPANS:
        raise ValueError("source spans are invalid")
    spans = tuple(_span_from_value(item) for item in value)
    _validate_spans(spans)
    return spans


def source_spans_from_bytes(value: bytes) -> tuple[SourceSpan, ...]:
    if len(value) > MAX_SOURCE_SPANS_BYTES:
        raise ValueError("source span metadata exceeds 64 KiB")
    try:
        decoded = value.decode("utf-8")
        parsed = loads_canonical_json(decoded)
    except (UnicodeDecodeError, ValueError) as error:
        raise ValueError("source span metadata is invalid") from error
    if canonical_json_bytes(parsed) != value:
        raise ValueError("source span metadata is not canonical JSON")
    return source_spans_from_value(parsed)


def _validate_spans(spans: tuple[SourceSpan, ...]) -> None:
    if type(spans) is not tuple or len(spans) > MAX_SOURCE_SPANS:
        raise ValueError("source spans are invalid")
    if any(type(span) is not SourceSpan for span in spans):
        raise TypeError("source spans must contain SourceSpan")


def _range_to_value(value: IndexRange) -> dict[str, int]:
    return {"start": value.start, "end": value.end}


def _span_from_value(value: object) -> SourceSpan:
    item = _mapping(value, {"source_id", "byte_ranges", "row_range", "precision"})
    ranges = item["byte_ranges"]
    if not isinstance(ranges, list):
        raise ValueError("source span byte ranges are invalid")
    row = item["row_range"]
    return SourceSpan(
        source_id=_text(item["source_id"]),
        byte_ranges=tuple(_range_from_value(entry) for entry in ranges),
        row_range=None if row is None else _range_from_value(row),
        precision=SourceSpanPrecision(item["precision"]),
    )


def _range_from_value(value: object) -> IndexRange:
    item = _mapping(value, {"start", "end"})
    return IndexRange(_integer(item["start"]), _integer(item["end"]))


def _mapping(value: object, keys: Iterable[str]) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or frozenset(value) != frozenset(keys):
        raise ValueError("source span fields are invalid")
    return value


def _text(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("source span text is invalid")
    return value


def _integer(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("source span range is invalid")
    return value
