"""Strict codecs for typed import payloads and their source-lineage envelope."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .model_validation import CalibrationQuality, CalibrationScopeKind, ValueStatus
from .models import (
    CalibrationBatch,
    CalibrationRecord,
    CalibrationScope,
    CampaignPointBatch,
    CampaignPointRecord,
    IndexRange,
    QualifiedFloat,
    QualifiedText,
    SyndromeBatch,
)


RECORD_BATCH_KEYS = frozenset(
    {
        "schema_version",
        "batch_id",
        "session_id",
        "segment_id",
        "sequence_start",
        "sequence_end",
        "record_count",
        "records",
        "provenance_id",
    }
)
CAMPAIGN_POINT_KEYS = frozenset(
    {
        "shots",
        "errors",
        "discards",
        "seconds",
        "decoder",
        "strong_id",
        "json_metadata",
        "custom_counts",
    }
)
CALIBRATION_KEYS = frozenset(
    {
        "schema_version",
        "calibration_id",
        "session_id",
        "effective_interval",
        "scope",
        "parameter",
        "value",
        "unit",
        "uncertainty",
        "quality",
        "source_system",
        "calibration_run_id",
        "original_representation",
        "provenance_id",
    }
)


def _strict(value: object, name: str, required: frozenset[str]) -> Mapping[str, Any]:
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


def _qualified_float(value: object, name: str) -> QualifiedFloat:
    item = _strict(value, name, frozenset({"value", "status"}))
    raw = item["value"]
    number = None if raw is None else _number(raw, f"{name}.value")
    return QualifiedFloat(number, ValueStatus(item["status"]))


def _qualified_text(value: object, name: str) -> QualifiedText:
    item = _strict(value, name, frozenset({"value", "status"}))
    raw = item["value"]
    text = None if raw is None else _string(raw, f"{name}.value")
    return QualifiedText(text, ValueStatus(item["status"]))


def _qualified_mapping(value: QualifiedFloat | QualifiedText) -> dict[str, object]:
    return {"value": value.value, "status": value.status.value}


def _batch_fields(item: Mapping[str, Any]) -> dict[str, object]:
    return {
        "batch_id": _string(item["batch_id"], "batch_id"),
        "session_id": _string(item["session_id"], "session_id"),
        "segment_id": _string(item["segment_id"], "segment_id"),
        "sequence_start": _integer(item["sequence_start"], "sequence_start"),
        "sequence_end": _integer(item["sequence_end"], "sequence_end"),
        "record_count": _integer(item["record_count"], "record_count"),
        "provenance_id": _string(item["provenance_id"], "provenance_id"),
        "schema_version": _string(item["schema_version"], "schema_version"),
    }


def _batch_mapping(batch: CampaignPointBatch | CalibrationBatch) -> dict[str, object]:
    return {
        "schema_version": batch.schema_version,
        "batch_id": batch.batch_id,
        "session_id": batch.session_id,
        "segment_id": batch.segment_id,
        "sequence_start": batch.sequence_start,
        "sequence_end": batch.sequence_end,
        "record_count": batch.record_count,
        "provenance_id": batch.provenance_id,
    }


def _campaign_record(value: object, index: int) -> CampaignPointRecord:
    item = _strict(value, f"campaign point records[{index}]", CAMPAIGN_POINT_KEYS)
    return CampaignPointRecord(
        shots=_integer(item["shots"], "shots"),
        errors=_integer(item["errors"], "errors"),
        discards=_integer(item["discards"], "discards"),
        seconds=_number(item["seconds"], "seconds"),
        decoder=_string(item["decoder"], "decoder"),
        strong_id=_string(item["strong_id"], "strong_id"),
        json_metadata=_string(item["json_metadata"], "json_metadata"),
        custom_counts=_string(item["custom_counts"], "custom_counts"),
    )


def campaign_point_batch_from_mapping(
    value: Mapping[str, object],
) -> CampaignPointBatch:
    item = _strict(value, "campaign point batch", RECORD_BATCH_KEYS)
    raw_records = item["records"]
    if not isinstance(raw_records, list):
        raise TypeError("campaign point records must be a list")
    records = tuple(
        _campaign_record(record, index) for index, record in enumerate(raw_records)
    )
    return CampaignPointBatch(records=records, **_batch_fields(item))


def campaign_point_batch_to_mapping(batch: CampaignPointBatch) -> dict[str, object]:
    records = [
        {
            "shots": record.shots,
            "errors": record.errors,
            "discards": record.discards,
            "seconds": record.seconds,
            "decoder": record.decoder,
            "strong_id": record.strong_id,
            "json_metadata": record.json_metadata,
            "custom_counts": record.custom_counts,
        }
        for record in batch.records
    ]
    return {**_batch_mapping(batch), "records": records}


def calibration_from_mapping(value: Mapping[str, object]) -> CalibrationRecord:
    item = _strict(value, "calibration record", CALIBRATION_KEYS)
    interval = _strict(
        item["effective_interval"], "effective_interval", frozenset({"start", "end"})
    )
    scope = _strict(item["scope"], "scope", frozenset({"kind", "id"}))
    parameter = _strict(
        item["parameter"], "parameter", frozenset({"name", "semantic_id"})
    )
    original = _strict(
        item["original_representation"],
        "original_representation",
        frozenset({"mime_type", "value"}),
    )
    return _build_calibration(item, interval, scope, parameter, original)


def _build_calibration(
    item: Mapping[str, Any],
    interval: Mapping[str, Any],
    scope: Mapping[str, Any],
    parameter: Mapping[str, Any],
    original: Mapping[str, Any],
) -> CalibrationRecord:
    end, run_id = interval["end"], item["calibration_run_id"]
    return CalibrationRecord(
        calibration_id=_string(item["calibration_id"], "calibration_id"),
        session_id=_string(item["session_id"], "session_id"),
        scope=CalibrationScope(
            CalibrationScopeKind(scope["kind"]), _string(scope["id"], "scope.id")
        ),
        parameter_name=_string(parameter["name"], "parameter.name"),
        semantic_id=_string(parameter["semantic_id"], "parameter.semantic_id"),
        value=_qualified_float(item["value"], "value"),
        unit=_qualified_text(item["unit"], "unit"),
        uncertainty=_qualified_float(item["uncertainty"], "uncertainty"),
        quality=CalibrationQuality(item["quality"]),
        source_system=_string(item["source_system"], "source_system"),
        provenance_id=_string(item["provenance_id"], "provenance_id"),
        effective_start=_string(interval["start"], "effective_interval.start"),
        effective_end=None if end is None else _string(end, "effective_interval.end"),
        calibration_run_id=None if run_id is None else _string(run_id, "run_id"),
        original_mime_type=_string(original["mime_type"], "original mime_type"),
        original_representation=_string(original["value"], "original value"),
        schema_version=_string(item["schema_version"], "schema_version"),
    )


def calibration_to_mapping(record: CalibrationRecord) -> dict[str, object]:
    return {
        "schema_version": record.schema_version,
        "calibration_id": record.calibration_id,
        "session_id": record.session_id,
        "effective_interval": {
            "start": record.effective_start,
            "end": record.effective_end,
        },
        "scope": {"kind": record.scope.kind.value, "id": record.scope.id},
        "parameter": {"name": record.parameter_name, "semantic_id": record.semantic_id},
        "value": _qualified_mapping(record.value),
        "unit": _qualified_mapping(record.unit),
        "uncertainty": _qualified_mapping(record.uncertainty),
        "quality": record.quality.value,
        "source_system": record.source_system,
        "calibration_run_id": record.calibration_run_id,
        "original_representation": {
            "mime_type": record.original_mime_type,
            "value": record.original_representation,
        },
        "provenance_id": record.provenance_id,
    }


def calibration_batch_from_mapping(value: Mapping[str, object]) -> CalibrationBatch:
    item = _strict(value, "calibration batch", RECORD_BATCH_KEYS)
    raw_records = item["records"]
    if not isinstance(raw_records, list):
        raise TypeError("calibration records must be a list")
    return CalibrationBatch(
        records=tuple(calibration_from_mapping(record) for record in raw_records),
        **_batch_fields(item),
    )


def calibration_batch_to_mapping(batch: CalibrationBatch) -> dict[str, object]:
    records = [calibration_to_mapping(record) for record in batch.records]
    return {**_batch_mapping(batch), "records": records}


def _range_from_mapping(value: object, name: str) -> IndexRange:
    item = _strict(value, name, frozenset({"start", "end"}))
    return IndexRange(_integer(item["start"], name), _integer(item["end"], name))


def _source_span_from_mapping(value: object, index: int):
    from .adapters.base import SourceSpan, SourceSpanPrecision

    item = _strict(
        value,
        f"source_spans[{index}]",
        frozenset({"source_id", "row_range", "byte_ranges", "precision"}),
    )
    byte_ranges, row_range = item["byte_ranges"], item["row_range"]
    if not isinstance(byte_ranges, list):
        raise TypeError("source span byte_ranges must be a list")
    return SourceSpan(
        source_id=_string(item["source_id"], "source span source_id"),
        byte_ranges=tuple(
            _range_from_mapping(entry, "byte_range") for entry in byte_ranges
        ),
        row_range=(
            None if row_range is None else _range_from_mapping(row_range, "row_range")
        ),
        precision=SourceSpanPrecision(item["precision"]),
    )


def import_chunk_from_mapping(value: Mapping[str, object]):
    from .adapters.base import ImportChunk
    from .model_codecs import batch_from_mapping

    item = _strict(
        value, "import chunk", frozenset({"record_kind", "payload", "source_spans"})
    )
    kind, payload_value = _string(item["record_kind"], "record_kind"), item["payload"]
    if not isinstance(payload_value, Mapping):
        raise TypeError("import chunk payload must be an object")
    decoders = {
        "syndromes": batch_from_mapping,
        "campaign_points": campaign_point_batch_from_mapping,
        "calibrations": calibration_batch_from_mapping,
    }
    if kind not in decoders:
        raise ValueError("import chunk record_kind is unsupported")
    raw_spans = item["source_spans"]
    if not isinstance(raw_spans, list):
        raise TypeError("import chunk source_spans must be a list")
    spans = tuple(
        _source_span_from_mapping(span, i) for i, span in enumerate(raw_spans)
    )
    return ImportChunk(payload=decoders[kind](payload_value), source_spans=spans)


def import_chunk_to_mapping(chunk) -> dict[str, object]:
    from .adapters.base import ImportChunk
    from .model_codecs import batch_to_mapping

    if type(chunk) is not ImportChunk:
        raise TypeError("chunk must be ImportChunk")
    payload = chunk.payload
    encoders = {
        SyndromeBatch: ("syndromes", batch_to_mapping),
        CampaignPointBatch: ("campaign_points", campaign_point_batch_to_mapping),
        CalibrationBatch: ("calibrations", calibration_batch_to_mapping),
    }
    kind, encoder = encoders[type(payload)]
    spans = [
        {
            "source_id": span.source_id,
            "row_range": (
                None if span.row_range is None else _range_mapping(span.row_range)
            ),
            "byte_ranges": [_range_mapping(value) for value in span.byte_ranges],
            "precision": span.precision.value,
        }
        for span in chunk.source_spans
    ]
    return {"record_kind": kind, "payload": encoder(payload), "source_spans": spans}


def _range_mapping(value: IndexRange) -> dict[str, int]:
    return {"start": value.start, "end": value.end}
