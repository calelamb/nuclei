"""Canonical Arrow codecs for aggregate campaign and calibration batches."""

from __future__ import annotations

import os
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .hashing import semantic_digest
from .model_validation import CalibrationQuality, CalibrationScopeKind, ValueStatus
from .models import (
    SCHEMA_VERSION,
    CalibrationBatch,
    CalibrationRecord,
    CalibrationScope,
    CampaignPointBatch,
    CampaignPointRecord,
    QualifiedFloat,
    QualifiedText,
)
from .storage_durability import DurableMover
from .storage_lineage import CALIBRATIONS, CAMPAIGN_POINTS, payload_kind


PARQUET_OPTIONS: dict[str, object] = {
    "version": "2.6",
    "compression": "zstd",
    "use_dictionary": False,
    "write_statistics": True,
    "store_schema": True,
    "write_page_checksum": True,
}


CAMPAIGN_FIELDS = (
    pa.field("sequence", pa.uint64(), nullable=False),
    pa.field("shots", pa.uint64(), nullable=False),
    pa.field("errors", pa.uint64(), nullable=False),
    pa.field("discards", pa.uint64(), nullable=False),
    pa.field("seconds", pa.float64(), nullable=False),
    pa.field("decoder", pa.string(), nullable=False),
    pa.field("strong_id", pa.string(), nullable=False),
    pa.field("json_metadata", pa.string(), nullable=False),
    pa.field("custom_counts", pa.string(), nullable=False),
)
CALIBRATION_FIELDS = (
    pa.field("sequence", pa.uint64(), nullable=False),
    pa.field("calibration_id", pa.string(), nullable=False),
    pa.field("session_id", pa.string(), nullable=False),
    pa.field("scope_kind", pa.string(), nullable=False),
    pa.field("scope_id", pa.string(), nullable=False),
    pa.field("parameter_name", pa.string(), nullable=False),
    pa.field("semantic_id", pa.string(), nullable=False),
    pa.field("value", pa.float64()),
    pa.field("value_status", pa.string(), nullable=False),
    pa.field("unit", pa.string()),
    pa.field("unit_status", pa.string(), nullable=False),
    pa.field("uncertainty", pa.float64()),
    pa.field("uncertainty_status", pa.string(), nullable=False),
    pa.field("quality", pa.string(), nullable=False),
    pa.field("source_system", pa.string(), nullable=False),
    pa.field("provenance_id", pa.string(), nullable=False),
    pa.field("effective_start", pa.string(), nullable=False),
    pa.field("effective_end", pa.string()),
    pa.field("calibration_run_id", pa.string()),
    pa.field("original_mime_type", pa.string(), nullable=False),
    pa.field("original_representation", pa.string(), nullable=False),
    pa.field("record_schema_version", pa.string(), nullable=False),
)


def typed_profile(record_kind: str) -> str:
    profiles = {
        CAMPAIGN_POINTS: "campaign-points-v1",
        CALIBRATIONS: "calibrations-v1",
    }
    try:
        return profiles[record_kind]
    except KeyError as error:
        raise ValueError("typed Parquet record kind is unsupported") from error


def typed_schema_fingerprint(record_kind: str) -> str:
    return semantic_digest(
        b"nuclei:qec-arrow-schema:v2\0",
        {"record_kind": record_kind, "profile": typed_profile(record_kind)},
    )


def write_typed_pending(
    path: Path,
    batch: CampaignPointBatch | CalibrationBatch,
    fingerprint: str,
    identity: str,
    source_spans: bytes,
    mover: DurableMover,
) -> None:
    table = _table(batch, fingerprint, identity, source_spans)
    with path.open("xb") as output:
        pq.write_table(table, output, row_group_size=65_536, **PARQUET_OPTIONS)
        output.flush()
        os.fsync(output.fileno())
    mover.sync_directory(path.parent)


def inspect_typed_partition(path: Path, schema: pa.Schema) -> dict[str, object]:
    kind = _metadata(schema, b"qec.record_kind")
    fields = CAMPAIGN_FIELDS if kind == CAMPAIGN_POINTS else CALIBRATION_FIELDS
    if kind not in {CAMPAIGN_POINTS, CALIBRATIONS}:
        raise ValueError("Parquet record kind is invalid")
    if tuple(schema) != fields:
        raise ValueError("Parquet fields do not match the canonical typed schema")
    if _metadata(schema, b"qec.schema_version") != SCHEMA_VERSION:
        raise ValueError("Parquet schema version is unsupported")
    if _metadata(schema, b"qec.schema_fingerprint") != typed_schema_fingerprint(kind):
        raise ValueError("Parquet schema fingerprint is invalid")
    try:
        table = pq.read_table(path, page_checksum_verification=True)
        table.validate(full=True)
        start = int(_metadata(schema, b"qec.sequence_start"))
        end = int(_metadata(schema, b"qec.sequence_end"))
        if table.num_rows < 1 or end - start != table.num_rows:
            raise ValueError("Parquet sequence range does not match its footer")
        if table.column("sequence").to_pylist() != list(range(start, end)):
            raise ValueError("Parquet sequence range does not match its footer")
        _validate_records(kind, table, schema)
    except (OSError, pa.ArrowException, KeyError, ValueError, TypeError) as error:
        if isinstance(error, ValueError) and str(error).startswith("Parquet"):
            raise
        raise ValueError("Parquet typed payload is invalid") from error
    return {
        "rows": table.num_rows,
        "sequence_start": start,
        "sequence_end": end,
        "segment_id": _metadata(schema, b"qec.segment_id"),
        "dataset_id": _metadata(schema, b"qec.dataset_id"),
        "schema_fingerprint": _metadata(schema, b"qec.schema_fingerprint"),
        "record_kind": kind,
        "source_spans": (schema.metadata or {}).get(b"qec.source_spans", b"[]"),
    }


def _table(
    batch: CampaignPointBatch | CalibrationBatch,
    fingerprint: str,
    identity: str,
    source_spans: bytes,
) -> pa.Table:
    kind = payload_kind(batch)
    fields = CAMPAIGN_FIELDS if kind == CAMPAIGN_POINTS else CALIBRATION_FIELDS
    schema = pa.schema(
        fields, metadata=_metadata_values(batch, fingerprint, identity, source_spans)
    )
    rows = (
        _campaign_rows(batch) if kind == CAMPAIGN_POINTS else _calibration_rows(batch)
    )
    return pa.Table.from_pylist(rows, schema=schema)


def _metadata_values(
    batch, fingerprint: str, identity: str, spans: bytes
) -> dict[bytes, bytes]:
    return {
        b"qec.schema_version": SCHEMA_VERSION.encode(),
        b"qec.record_kind": payload_kind(batch).encode(),
        b"qec.batch_id": batch.batch_id.encode(),
        b"qec.session_id": batch.session_id.encode(),
        b"qec.segment_id": batch.segment_id.encode(),
        b"qec.provenance_id": batch.provenance_id.encode(),
        b"qec.schema_fingerprint": fingerprint.encode(),
        b"qec.dataset_id": identity.encode(),
        b"qec.sequence_start": str(batch.sequence_start).encode(),
        b"qec.sequence_end": str(batch.sequence_end).encode(),
        b"qec.source_spans": spans,
    }


def _campaign_rows(batch: CampaignPointBatch) -> list[dict[str, object]]:
    return [
        {
            "sequence": batch.sequence_start + index,
            "shots": record.shots,
            "errors": record.errors,
            "discards": record.discards,
            "seconds": record.seconds,
            "decoder": record.decoder,
            "strong_id": record.strong_id,
            "json_metadata": record.json_metadata,
            "custom_counts": record.custom_counts,
        }
        for index, record in enumerate(batch.records)
    ]


def _calibration_rows(batch: CalibrationBatch) -> list[dict[str, object]]:
    return [
        {
            "sequence": batch.sequence_start + index,
            "calibration_id": record.calibration_id,
            "session_id": record.session_id,
            "scope_kind": record.scope.kind.value,
            "scope_id": record.scope.id,
            "parameter_name": record.parameter_name,
            "semantic_id": record.semantic_id,
            "value": record.value.value,
            "value_status": record.value.status.value,
            "unit": record.unit.value,
            "unit_status": record.unit.status.value,
            "uncertainty": record.uncertainty.value,
            "uncertainty_status": record.uncertainty.status.value,
            "quality": record.quality.value,
            "source_system": record.source_system,
            "provenance_id": record.provenance_id,
            "effective_start": record.effective_start,
            "effective_end": record.effective_end,
            "calibration_run_id": record.calibration_run_id,
            "original_mime_type": record.original_mime_type,
            "original_representation": record.original_representation,
            "record_schema_version": record.schema_version,
        }
        for index, record in enumerate(batch.records)
    ]


def _validate_records(kind: str, table: pa.Table, schema: pa.Schema) -> None:
    metadata = schema.metadata or {}
    common = {
        "batch_id": _metadata(schema, b"qec.batch_id"),
        "session_id": _metadata(schema, b"qec.session_id"),
        "segment_id": _metadata(schema, b"qec.segment_id"),
        "sequence_start": int(_metadata(schema, b"qec.sequence_start")),
        "sequence_end": int(_metadata(schema, b"qec.sequence_end")),
        "record_count": table.num_rows,
        "provenance_id": _metadata(schema, b"qec.provenance_id"),
    }
    if kind == CAMPAIGN_POINTS:
        records = tuple(_campaign_record(row) for row in table.to_pylist())
        CampaignPointBatch(records=records, **common)
    else:
        records = tuple(_calibration_record(row) for row in table.to_pylist())
        CalibrationBatch(records=records, **common)
    if b"qec.source_spans" not in metadata:
        raise ValueError("Parquet source lineage is missing")


def _campaign_record(row: dict[str, object]) -> CampaignPointRecord:
    return CampaignPointRecord(
        **{
            key: row[key]
            for key in (
                "shots",
                "errors",
                "discards",
                "seconds",
                "decoder",
                "strong_id",
                "json_metadata",
                "custom_counts",
            )
        }
    )


def _calibration_record(row: dict[str, object]) -> CalibrationRecord:
    return CalibrationRecord(
        calibration_id=row["calibration_id"],
        session_id=row["session_id"],
        scope=CalibrationScope(
            CalibrationScopeKind(row["scope_kind"]), row["scope_id"]
        ),
        parameter_name=row["parameter_name"],
        semantic_id=row["semantic_id"],
        value=QualifiedFloat(row["value"], ValueStatus(row["value_status"])),
        unit=QualifiedText(row["unit"], ValueStatus(row["unit_status"])),
        uncertainty=QualifiedFloat(
            row["uncertainty"], ValueStatus(row["uncertainty_status"])
        ),
        quality=CalibrationQuality(row["quality"]),
        source_system=row["source_system"],
        provenance_id=row["provenance_id"],
        effective_start=row["effective_start"],
        effective_end=row["effective_end"],
        calibration_run_id=row["calibration_run_id"],
        original_mime_type=row["original_mime_type"],
        original_representation=row["original_representation"],
        schema_version=row["record_schema_version"],
    )


def _metadata(schema: pa.Schema, key: bytes) -> str:
    try:
        return (schema.metadata or {})[key].decode("utf-8")
    except (KeyError, UnicodeDecodeError) as error:
        raise ValueError(f"Parquet schema is missing {key.decode()}") from error
