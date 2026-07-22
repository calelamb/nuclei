"""Bounded API row serialization for typed QEC datasets."""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping

import pyarrow as pa

from .model_codecs import loads_canonical_json


def serialize_typed_rows(
    batches: tuple[pa.RecordBatch, ...], finite: Callable[[object], float]
) -> tuple[dict[str, object], ...] | None:
    names = batches[0].schema.names if batches else []
    if "strong_id" in names:
        return _campaign_rows(batches, finite)
    if "calibration_id" in names:
        return tuple(_calibration_row(row) for row in _rows(batches))
    return None


def _campaign_rows(
    batches: tuple[pa.RecordBatch, ...], finite: Callable[[object], float]
) -> tuple[dict[str, object], ...]:
    return tuple(
        {
            "sequence": str(row["sequence"]),
            "shots": str(row["shots"]),
            "errors": str(row["errors"]),
            "discards": str(row["discards"]),
            "seconds": finite(row["seconds"]),
            "decoder": row["decoder"],
            "strongId": row["strong_id"],
            "jsonMetadata": loads_canonical_json(row["json_metadata"]),
            "customCounts": loads_canonical_json(row["custom_counts"]),
        }
        for row in _rows(batches)
    )


def _calibration_row(row: Mapping[str, object]) -> dict[str, object]:
    return {
        "sequence": str(row["sequence"]),
        "calibrationId": row["calibration_id"],
        "sessionId": row["session_id"],
        "scope": {"kind": row["scope_kind"], "id": row["scope_id"]},
        "parameter": {
            "name": row["parameter_name"],
            "semanticId": row["semantic_id"],
        },
        "value": {"value": row["value"], "status": row["value_status"]},
        "unit": {"value": row["unit"], "status": row["unit_status"]},
        "uncertainty": {
            "value": row["uncertainty"],
            "status": row["uncertainty_status"],
        },
        "quality": row["quality"],
        "sourceSystem": row["source_system"],
        "provenanceId": row["provenance_id"],
        "effectiveInterval": {
            "start": row["effective_start"],
            "end": row["effective_end"],
        },
        "calibrationRunId": row["calibration_run_id"],
        "originalRepresentation": {
            "mimeType": row["original_mime_type"],
            "value": row["original_representation"],
        },
        "schemaVersion": row["record_schema_version"],
    }


def _rows(batches: tuple[pa.RecordBatch, ...]) -> Iterator[dict[str, object]]:
    for batch in batches:
        yield from batch.to_pylist()
