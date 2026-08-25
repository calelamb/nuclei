"""Explicit lossless JSON-boundary codecs for durable canonical records."""

from __future__ import annotations

import base64
import binascii
import json
import math
from typing import Any, Mapping

from .models import (
    AdapterIdentity,
    CorrectionKind,
    CorrectionValue,
    DataQualityFlag,
    DecodeError,
    DecodeInput,
    DecoderIdentity,
    DecodeRecord,
    DecodeStatus,
    IndexRange,
    PackedBits,
    QualifiedCount,
    QualifiedCorrection,
    QualifiedFloat,
    QualifiedPackedBits,
    QualifiedRange,
    QualifiedText,
    QualifiedTimestamps,
    QualifiedQuantity,
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
DECODE_KEYS = frozenset(
    {
        "schema_version",
        "decode_id",
        "session_id",
        "input",
        "decoder",
        "status",
        "prediction",
        "confidence",
        "correction",
        "predicted_logical_flips",
        "known_truth",
        "pipeline_latency",
        "total_latency",
        "error",
        "provenance_id",
    }
)


def _reject_non_finite_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant is forbidden: {value}")


def _parse_finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"non-finite JSON number is forbidden: {value}")
    return parsed


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key is forbidden: {key}")
        result[key] = value
    return result


def loads_canonical_json(document: str) -> Any:
    """Parse canonical boundary JSON without JavaScript-incompatible constants."""
    if not isinstance(document, str):
        raise TypeError("canonical JSON document must be a string")
    return json.loads(
        document,
        parse_constant=_reject_non_finite_constant,
        parse_float=_parse_finite_float,
        object_pairs_hook=_unique_object,
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
    item = _strict_object(
        value, name, frozenset({"encoding", "bit_order", "bit_width", "data"})
    )
    encoded = _string(item["data"], f"{name}.data")
    if item["encoding"] != "base64" or item["bit_order"] != "lsb0":
        raise ValueError(f"{name} must use canonical base64 LSB0 encoding")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(f"{name}.data is not valid base64") from error
    if base64.b64encode(data).decode("ascii") != encoded:
        raise ValueError(f"{name}.data is not canonical base64")
    return PackedBits(_integer(item["bit_width"], f"{name}.bit_width"), data)


def _packed_to(value: PackedBits) -> dict[str, object]:
    return {
        "encoding": "base64",
        "bit_order": "lsb0",
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


def _correction_from(value: object) -> QualifiedCorrection:
    item = _strict_object(value, "correction", frozenset({"value", "status"}))
    status = ValueStatus(item["status"])
    if item["value"] is None:
        return QualifiedCorrection(None, status)
    raw = item["value"]
    if not isinstance(raw, Mapping):
        raise TypeError("correction.value must be an object")
    if raw.get("kind") == CorrectionKind.EDGE_IDS.value:
        edge_item = _strict_object(
            raw, "correction.value", frozenset({"kind", "edge_ids"})
        )
        edge_ids = edge_item["edge_ids"]
        if not isinstance(edge_ids, list) or not all(
            isinstance(edge, str) for edge in edge_ids
        ):
            raise TypeError("correction edge_ids must be a string list")
        correction = CorrectionValue.edges(tuple(edge_ids))
    else:
        ref_item = _strict_object(
            raw, "correction.value", frozenset({"kind", "compact_ref"})
        )
        if ref_item["kind"] != CorrectionKind.COMPACT_REF.value:
            raise ValueError("correction kind is invalid")
        correction = CorrectionValue.compact(
            _string(ref_item["compact_ref"], "compact_ref")
        )
    return QualifiedCorrection(correction, status)


def _correction_to(value: QualifiedCorrection) -> dict[str, object]:
    if value.value is None:
        return _qualified_to(None, value.status)
    correction = value.value
    raw: dict[str, object]
    if correction.kind is CorrectionKind.EDGE_IDS:
        raw = {"kind": "edge_ids", "edge_ids": list(correction.edge_ids)}
    else:
        raw = {"kind": "compact_ref", "compact_ref": correction.compact_ref}
    return _qualified_to(raw, value.status)


def _quantity_from(value: object, name: str) -> QualifiedQuantity:
    item = _strict_object(value, name, frozenset({"value", "unit", "status"}))
    raw_value = item["value"]
    number = None if raw_value is None else _number(raw_value, f"{name}.value")
    unit = None if item["unit"] is None else _string(item["unit"], f"{name}.unit")
    return QualifiedQuantity(number, unit, ValueStatus(item["status"]))


def _quantity_to(value: QualifiedQuantity) -> dict[str, object]:
    return {"value": value.value, "unit": value.unit, "status": value.status.value}


def decode_from_mapping(value: Mapping[str, object]) -> DecodeRecord:
    item = _strict_object(value, "decode result", DECODE_KEYS)
    input_item = _strict_object(
        item["input"],
        "input",
        frozenset({"batch_id", "sequence_start", "sequence_end"}),
    )
    decoder = _strict_object(
        item["decoder"],
        "decoder",
        frozenset({"name", "version", "configuration_sha256"}),
    )
    error_item = item["error"]
    error = None
    if error_item is not None:
        parsed = _strict_object(error_item, "error", frozenset({"code", "message"}))
        error = DecodeError(
            _string(parsed["code"], "error.code"),
            _string(parsed["message"], "error.message"),
        )
    return DecodeRecord(
        decode_id=_string(item["decode_id"], "decode_id"),
        session_id=_string(item["session_id"], "session_id"),
        input=DecodeInput(
            _string(input_item["batch_id"], "batch_id"),
            _integer(input_item["sequence_start"], "sequence_start"),
            _integer(input_item["sequence_end"], "sequence_end"),
        ),
        decoder=DecoderIdentity(
            _string(decoder["name"], "decoder.name"),
            _string(decoder["version"], "decoder.version"),
            _string(decoder["configuration_sha256"], "configuration_sha256"),
        ),
        status=DecodeStatus(item["status"]),
        prediction=_packed_from(item["prediction"], "prediction"),
        confidence=_qualified_float_from(item["confidence"], "confidence"),
        correction=_correction_from(item["correction"]),
        predicted_logical_flips=_packed_from(
            item["predicted_logical_flips"], "predicted_logical_flips"
        ),
        known_truth=_qualified_bits_from(item["known_truth"], "known_truth"),
        pipeline_latency=_quantity_from(item["pipeline_latency"], "pipeline_latency"),
        total_latency=_quantity_from(item["total_latency"], "total_latency"),
        error=error,
        provenance_id=_string(item["provenance_id"], "provenance_id"),
        schema_version=_string(item["schema_version"], "schema_version"),
    )


def decode_to_mapping(decode: DecodeRecord) -> dict[str, object]:
    error = (
        None
        if decode.error is None
        else {"code": decode.error.code, "message": decode.error.message}
    )
    return {
        "schema_version": decode.schema_version,
        "decode_id": decode.decode_id,
        "session_id": decode.session_id,
        "input": {
            "batch_id": decode.input.batch_id,
            "sequence_start": decode.input.sequence_start,
            "sequence_end": decode.input.sequence_end,
        },
        "decoder": {
            "name": decode.decoder.name,
            "version": decode.decoder.version,
            "configuration_sha256": decode.decoder.configuration_sha256,
        },
        "status": decode.status.value,
        "prediction": _packed_to(decode.prediction),
        "confidence": _qualified_to(decode.confidence.value, decode.confidence.status),
        "correction": _correction_to(decode.correction),
        "predicted_logical_flips": _packed_to(decode.predicted_logical_flips),
        "known_truth": _qualified_bits_to(decode.known_truth),
        "pipeline_latency": _quantity_to(decode.pipeline_latency),
        "total_latency": _quantity_to(decode.total_latency),
        "error": error,
        "provenance_id": decode.provenance_id,
    }


from .json_document import canonical_json_document  # noqa: E402, F401
from .typed_import_codecs import (  # noqa: E402, F401
    calibration_batch_from_mapping,
    calibration_batch_to_mapping,
    calibration_from_mapping,
    calibration_to_mapping,
    campaign_point_batch_from_mapping,
    campaign_point_batch_to_mapping,
    import_chunk_from_mapping,
    import_chunk_to_mapping,
)
