"""Explicit lossless JSON-boundary codecs for durable canonical records."""

from __future__ import annotations

import base64
import binascii
from typing import Any, Mapping

from .models import (
    AdapterIdentity,
    DataQualityFlag,
    IndexRange,
    PackedBits,
    QualifiedCount,
    QualifiedFloat,
    QualifiedPackedBits,
    QualifiedRange,
    QualifiedText,
    QualifiedTimestamps,
    SessionCounts,
    SessionKind,
    SessionRecord,
    SessionReferences,
    SessionStatus,
    SourceClock,
    SyndromeBatch,
    Timebase,
    TimestampSeries,
    ValueStatus,
)


SESSION_KEYS = frozenset(
    {
        "schema_version",
        "session_id",
        "kind",
        "status",
        "created_at",
        "started_at",
        "completed_at",
        "adapter",
        "references",
        "counts",
        "source_clock",
        "timebase",
        "provenance_id",
        "segments",
    }
)
BATCH_KEYS = frozenset(
    {
        "schema_version",
        "batch_id",
        "session_id",
        "segment_id",
        "sequence_start",
        "sequence_end",
        "record_count",
        "shot_range",
        "round_range",
        "source_timestamps",
        "detector_events",
        "measurements",
        "observables",
        "erasures",
        "leakage",
        "heralds",
        "circuit_revision",
        "topology_revision",
        "data_quality",
        "provenance_id",
    }
)


def _strict_object(
    value: object, name: str, required: frozenset[str]
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be an object")
    keys = frozenset(value.keys())
    if keys != required:
        raise ValueError(
            f"{name} fields differ: missing={required - keys}, extra={keys - required}"
        )
    return value


def _string(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value


def _integer(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError(f"{name} must be an integer")
    return value


def _number(value: object, name: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise TypeError(f"{name} must be a number")
    return float(value)


def _qualified_text_from(value: object, name: str) -> QualifiedText:
    item = _strict_object(value, name, frozenset({"value", "status"}))
    raw_value = item["value"]
    text = None if raw_value is None else _string(raw_value, f"{name}.value")
    return QualifiedText(text, ValueStatus(item["status"]))


def _qualified_count_from(value: object, name: str) -> QualifiedCount:
    item = _strict_object(value, name, frozenset({"value", "status"}))
    raw_value = item["value"]
    count = None if raw_value is None else _integer(raw_value, f"{name}.value")
    return QualifiedCount(count, ValueStatus(item["status"]))


def _qualified_float_from(value: object, name: str) -> QualifiedFloat:
    item = _strict_object(value, name, frozenset({"value", "status"}))
    raw_value = item["value"]
    number = None if raw_value is None else _number(raw_value, f"{name}.value")
    return QualifiedFloat(number, ValueStatus(item["status"]))


def _qualified_to(value: object | None, status: ValueStatus) -> dict[str, object]:
    return {"value": value, "status": status.value}


def _qualified_value_to(
    value: QualifiedText | QualifiedCount | QualifiedFloat,
) -> dict[str, object]:
    return _qualified_to(value.value, value.status)


def _packed_from(value: object, name: str) -> PackedBits:
    item = _strict_object(value, name, frozenset({"encoding", "bit_width", "data"}))
    encoded = _string(item["data"], f"{name}.data")
    if item["encoding"] != "base64":
        raise ValueError(f"{name} must use base64 encoding")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(f"{name}.data is not valid base64") from error
    return PackedBits(_integer(item["bit_width"], f"{name}.bit_width"), data)


def _packed_to(value: PackedBits) -> dict[str, object]:
    return {
        "encoding": "base64",
        "bit_width": value.bit_width,
        "data": base64.b64encode(value.data).decode("ascii"),
    }


def _qualified_bits_from(value: object, name: str) -> QualifiedPackedBits:
    item = _strict_object(value, name, frozenset({"value", "status"}))
    packed = (
        None if item["value"] is None else _packed_from(item["value"], f"{name}.value")
    )
    return QualifiedPackedBits(packed, ValueStatus(item["status"]))


def _qualified_bits_to(value: QualifiedPackedBits) -> dict[str, object]:
    packed = None if value.value is None else _packed_to(value.value)
    return _qualified_to(packed, value.status)


def _qualified_range_from(value: object, name: str) -> QualifiedRange:
    item = _strict_object(value, name, frozenset({"value", "status"}))
    if item["value"] is None:
        return QualifiedRange(None, ValueStatus(item["status"]))
    raw = _strict_object(item["value"], f"{name}.value", frozenset({"start", "end"}))
    index_range = IndexRange(
        _integer(raw["start"], "range.start"), _integer(raw["end"], "range.end")
    )
    return QualifiedRange(index_range, ValueStatus(item["status"]))


def _qualified_range_to(value: QualifiedRange) -> dict[str, object]:
    raw = (
        None
        if value.value is None
        else {"start": value.value.start, "end": value.value.end}
    )
    return _qualified_to(raw, value.status)


def _qualified_timestamps_from(value: object) -> QualifiedTimestamps:
    item = _strict_object(value, "source_timestamps", frozenset({"value", "status"}))
    if item["value"] is None:
        return QualifiedTimestamps(None, ValueStatus(item["status"]))
    raw = _strict_object(
        item["value"], "source_timestamps.value", frozenset({"values", "unit"})
    )
    values = raw["values"]
    if not isinstance(values, list):
        raise TypeError("source_timestamps.values must be a list")
    series = TimestampSeries(
        tuple(_number(value, "timestamp") for value in values),
        _string(raw["unit"], "timestamp unit"),
    )
    return QualifiedTimestamps(series, ValueStatus(item["status"]))


def _session_parts(item: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    return (
        _strict_object(item["adapter"], "adapter", frozenset({"id", "version"})),
        _strict_object(
            item["references"],
            "references",
            frozenset({"circuit", "detector_error_model", "topology", "calibration"}),
        ),
        _strict_object(
            item["counts"],
            "counts",
            frozenset({"detectors", "observables", "measurements", "logical_patches"}),
        ),
        _strict_object(
            item["source_clock"], "source_clock", frozenset({"identity", "description"})
        ),
        _strict_object(
            item["timebase"],
            "timebase",
            frozenset({"domain", "unit", "tick_period", "description"}),
        ),
    )


def session_from_mapping(value: Mapping[str, object]) -> SessionRecord:
    item = _strict_object(value, "session", SESSION_KEYS)
    adapter, references, counts, clock, timebase = _session_parts(item)
    segments = item["segments"]
    if not isinstance(segments, list) or not all(
        isinstance(segment, str) for segment in segments
    ):
        raise TypeError("segments must be a list of strings")
    return SessionRecord(
        session_id=_string(item["session_id"], "session_id"),
        kind=SessionKind(item["kind"]),
        status=SessionStatus(item["status"]),
        adapter=AdapterIdentity(
            _string(adapter["id"], "adapter.id"),
            _string(adapter["version"], "adapter.version"),
        ),
        provenance_id=_string(item["provenance_id"], "provenance_id"),
        created_at=_string(item["created_at"], "created_at"),
        started_at=_qualified_text_from(item["started_at"], "started_at"),
        completed_at=_qualified_text_from(item["completed_at"], "completed_at"),
        references=SessionReferences(
            **{
                name: _qualified_text_from(references[name], f"references.{name}")
                for name in references
            }
        ),
        counts=SessionCounts(
            **{
                name: _qualified_count_from(counts[name], f"counts.{name}")
                for name in counts
            }
        ),
        source_clock=SourceClock(
            _qualified_text_from(clock["identity"], "source_clock.identity"),
            _string(clock["description"], "source_clock.description"),
        ),
        timebase=Timebase(
            _string(timebase["domain"], "timebase.domain"),
            _qualified_text_from(timebase["unit"], "timebase.unit"),
            _qualified_float_from(timebase["tick_period"], "timebase.tick_period"),
            _string(timebase["description"], "timebase.description"),
        ),
        segments=tuple(segments),
        schema_version=_string(item["schema_version"], "schema_version"),
    )


def session_to_mapping(session: SessionRecord) -> dict[str, object]:
    return {
        "schema_version": session.schema_version,
        "session_id": session.session_id,
        "kind": session.kind.value,
        "status": session.status.value,
        "created_at": session.created_at,
        "started_at": _qualified_value_to(session.started_at),
        "completed_at": _qualified_value_to(session.completed_at),
        "adapter": {"id": session.adapter.id, "version": session.adapter.version},
        "references": {
            name: _qualified_value_to(getattr(session.references, name))
            for name in ("circuit", "detector_error_model", "topology", "calibration")
        },
        "counts": {
            name: _qualified_value_to(getattr(session.counts, name))
            for name in ("detectors", "observables", "measurements", "logical_patches")
        },
        "source_clock": {
            "identity": _qualified_value_to(session.source_clock.identity),
            "description": session.source_clock.description,
        },
        "timebase": {
            "domain": session.timebase.domain,
            "unit": _qualified_value_to(session.timebase.unit),
            "tick_period": _qualified_to(
                session.timebase.tick_period.value, session.timebase.tick_period.status
            ),
            "description": session.timebase.description,
        },
        "provenance_id": session.provenance_id,
        "segments": list(session.segments),
    }


def batch_from_mapping(value: Mapping[str, object]) -> SyndromeBatch:
    item = _strict_object(value, "syndrome batch", BATCH_KEYS)
    quality = item["data_quality"]
    if not isinstance(quality, list):
        raise TypeError("data_quality must be a list")
    return SyndromeBatch(
        batch_id=_string(item["batch_id"], "batch_id"),
        session_id=_string(item["session_id"], "session_id"),
        segment_id=_string(item["segment_id"], "segment_id"),
        sequence_start=_integer(item["sequence_start"], "sequence_start"),
        sequence_end=_integer(item["sequence_end"], "sequence_end"),
        record_count=_integer(item["record_count"], "record_count"),
        detector_events=_packed_from(item["detector_events"], "detector_events"),
        shot_range=_qualified_range_from(item["shot_range"], "shot_range"),
        round_range=_qualified_range_from(item["round_range"], "round_range"),
        source_timestamps=_qualified_timestamps_from(item["source_timestamps"]),
        measurements=_qualified_bits_from(item["measurements"], "measurements"),
        observables=_qualified_bits_from(item["observables"], "observables"),
        erasures=_qualified_bits_from(item["erasures"], "erasures"),
        leakage=_qualified_bits_from(item["leakage"], "leakage"),
        heralds=_qualified_bits_from(item["heralds"], "heralds"),
        circuit_revision=_qualified_text_from(
            item["circuit_revision"], "circuit_revision"
        ),
        topology_revision=_qualified_text_from(
            item["topology_revision"], "topology_revision"
        ),
        data_quality=tuple(DataQualityFlag(flag) for flag in quality),
        provenance_id=_string(item["provenance_id"], "provenance_id"),
        schema_version=_string(item["schema_version"], "schema_version"),
    )


def batch_to_mapping(batch: SyndromeBatch) -> dict[str, object]:
    timestamp_value = batch.source_timestamps.value
    timestamps = (
        None
        if timestamp_value is None
        else {"values": list(timestamp_value.values), "unit": timestamp_value.unit}
    )
    return {
        "schema_version": batch.schema_version,
        "batch_id": batch.batch_id,
        "session_id": batch.session_id,
        "segment_id": batch.segment_id,
        "sequence_start": batch.sequence_start,
        "sequence_end": batch.sequence_end,
        "record_count": batch.record_count,
        "shot_range": _qualified_range_to(batch.shot_range),
        "round_range": _qualified_range_to(batch.round_range),
        "source_timestamps": _qualified_to(timestamps, batch.source_timestamps.status),
        "detector_events": _packed_to(batch.detector_events),
        "measurements": _qualified_bits_to(batch.measurements),
        "observables": _qualified_bits_to(batch.observables),
        "erasures": _qualified_bits_to(batch.erasures),
        "leakage": _qualified_bits_to(batch.leakage),
        "heralds": _qualified_bits_to(batch.heralds),
        "circuit_revision": _qualified_to(
            batch.circuit_revision.value, batch.circuit_revision.status
        ),
        "topology_revision": _qualified_to(
            batch.topology_revision.value, batch.topology_revision.status
        ),
        "data_quality": [flag.value for flag in batch.data_quality],
        "provenance_id": batch.provenance_id,
    }
