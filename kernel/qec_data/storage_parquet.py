"""Arrow conversion and verification internals for QEC session storage."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .hashing import semantic_digest, sha256_file
from .models import PackedBits, QualifiedPackedBits, SCHEMA_VERSION, SyndromeBatch
from .storage_durability import DurableMover


RECORD_KIND = "syndromes"
MAX_PARTITION_ROWS = 65_536
PACKED_FIELDS = ("observables", "measurements", "erasures", "leakage", "heralds")
PARQUET_OPTIONS: dict[str, object] = {
    "version": "2.6",
    "compression": "zstd",
    "use_dictionary": False,
    "write_statistics": True,
    "store_schema": True,
    "write_page_checksum": True,
}


@dataclass(frozen=True, slots=True)
class PendingPartition:
    path: Path
    sha256: str
    rows: int
    sequence_start: int
    sequence_end: int
    segment_id: str
    dataset_id: str
    schema_fingerprint: str
    is_final: bool = False
    journal_generation: int = -1


def _validate_padding(name: str, packed: PackedBits, count: int) -> None:
    remainder = packed.bit_width % 8
    if remainder == 0:
        return
    stride = packed.bytes_per_record
    padding_mask = 0xFF ^ ((1 << remainder) - 1)
    if any(
        packed.data[index * stride + stride - 1] & padding_mask
        for index in range(count)
    ):
        raise ValueError(f"{name} has nonzero padding bits")


def validate_batch_padding(batch: SyndromeBatch) -> None:
    _validate_padding("detectors", batch.detector_events, batch.record_count)
    for name in PACKED_FIELDS:
        packed: QualifiedPackedBits = getattr(batch, name)
        if packed.value is not None:
            _validate_padding(name, packed.value, batch.record_count)


def packed_profile(batch: SyndromeBatch) -> dict[str, object]:
    profile: dict[str, object] = {"detectors": batch.detector_events.bit_width}
    for name in PACKED_FIELDS:
        packed = getattr(batch, name)
        if packed.value is not None:
            profile[name] = packed.value.bit_width
    if batch.source_timestamps.value is not None:
        profile["timestamp_unit"] = batch.source_timestamps.value.unit
    if batch.round_range.value is not None:
        profile["round"] = True
    return profile


def schema_fingerprint(profile: dict[str, object]) -> str:
    return semantic_digest(b"nuclei:qec-arrow-schema:v1\0", profile)


def _packed_field(name: str, width: int) -> pa.Field:
    metadata = {
        b"qec.bit_count": str(width).encode(),
        b"qec.bit_order": b"lsb0",
    }
    return pa.field(
        name,
        pa.binary((width + 7) // 8),
        nullable=False,
        metadata=metadata,
    )


def _schema(batch: SyndromeBatch, fingerprint: str, identity: str) -> pa.Schema:
    fields = [pa.field("sequence", pa.uint64(), nullable=False)]
    if batch.source_timestamps.value is not None:
        fields.append(pa.field("timestamp_ns", pa.int64(), nullable=False))
    if batch.round_range.value is not None:
        fields.append(pa.field("round", pa.uint32(), nullable=False))
    fields.append(_packed_field("detectors", batch.detector_events.bit_width))
    for name in PACKED_FIELDS:
        packed = getattr(batch, name)
        if packed.value is not None:
            fields.append(_packed_field(name, packed.value.bit_width))
    metadata = {
        b"qec.schema_version": SCHEMA_VERSION.encode(),
        b"qec.record_kind": RECORD_KIND.encode(),
        b"qec.segment_id": batch.segment_id.encode(),
        b"qec.schema_fingerprint": fingerprint.encode(),
        b"qec.dataset_id": identity.encode(),
        b"qec.sequence_start": str(batch.sequence_start).encode(),
        b"qec.sequence_end": str(batch.sequence_end).encode(),
    }
    return pa.schema(fields, metadata=metadata)


def _packed_array(packed: PackedBits, count: int) -> pa.Array:
    return pa.Array.from_buffers(
        pa.binary(packed.bytes_per_record),
        count,
        [None, pa.py_buffer(packed.data)],
    )


def _timestamp_array(batch: SyndromeBatch) -> pa.Array:
    series = batch.source_timestamps.value
    if series is None or series.unit != "ns":
        raise ValueError("source timestamps must use integral ns values")
    if any(not float(value).is_integer() for value in series.values):
        raise ValueError("source timestamps must use integral ns values")
    return pa.array((int(value) for value in series.values), type=pa.int64())


def _record_batch(batch: SyndromeBatch, schema: pa.Schema) -> pa.RecordBatch:
    arrays: list[pa.Array] = [
        pa.array(range(batch.sequence_start, batch.sequence_end), type=pa.uint64())
    ]
    if batch.source_timestamps.value is not None:
        arrays.append(_timestamp_array(batch))
    if batch.round_range.value is not None:
        rounds = batch.round_range.value
        if rounds.end - rounds.start != batch.record_count:
            raise ValueError("round range must equal record_count")
        arrays.append(pa.array(range(rounds.start, rounds.end), type=pa.uint32()))
    arrays.append(_packed_array(batch.detector_events, batch.record_count))
    for name in PACKED_FIELDS:
        packed: QualifiedPackedBits = getattr(batch, name)
        if packed.value is not None:
            arrays.append(_packed_array(packed.value, batch.record_count))
    return pa.RecordBatch.from_arrays(arrays, schema=schema)


def write_pending(
    path: Path,
    batch: SyndromeBatch,
    fingerprint: str,
    identity: str,
    mover: DurableMover,
) -> None:
    if batch.record_count > MAX_PARTITION_ROWS:
        raise ValueError("canonical Parquet partitions cannot exceed 65,536 rows")
    schema = _schema(batch, fingerprint, identity)
    record_batch = _record_batch(batch, schema)
    with path.open("xb") as output:
        with pq.ParquetWriter(output, schema, **PARQUET_OPTIONS) as writer:
            writer.write_batch(record_batch, row_group_size=65_536)
        output.flush()
        os.fsync(output.fileno())
    mover.sync_directory(path.parent)
    inspected = inspect_partition(path)
    if inspected.rows != batch.record_count:
        path.unlink(missing_ok=True)
        raise ValueError("Parquet row count does not match batch")


def _metadata_text(schema: pa.Schema, key: bytes) -> str:
    metadata = schema.metadata or {}
    try:
        return metadata[key].decode("utf-8")
    except (KeyError, UnicodeDecodeError) as error:
        raise ValueError(f"Parquet schema is missing {key.decode()}") from error


def _packed_width(field: pa.Field) -> int:
    if field.nullable or not pa.types.is_fixed_size_binary(field.type):
        raise ValueError(f"Parquet field {field.name} must use fixed-size binary")
    metadata = field.metadata or {}
    if metadata.get(b"qec.bit_order") != b"lsb0":
        raise ValueError(f"Parquet field {field.name} has invalid bit order")
    try:
        width = int(metadata[b"qec.bit_count"])
    except (KeyError, ValueError) as error:
        raise ValueError(f"Parquet field {field.name} has invalid bit width") from error
    byte_width = field.type.byte_width
    if width < 1 or (width + 7) // 8 != byte_width:
        raise ValueError(f"Parquet field {field.name} has invalid bit width")
    return width


def _validate_schema(schema: pa.Schema) -> None:
    if _metadata_text(schema, b"qec.schema_version") != SCHEMA_VERSION:
        raise ValueError("Parquet schema version is unsupported")
    if _metadata_text(schema, b"qec.record_kind") != RECORD_KIND:
        raise ValueError("Parquet record kind is invalid")
    names = schema.names
    if (
        not names
        or names[0] != "sequence"
        or schema.field(0) != pa.field("sequence", pa.uint64(), nullable=False)
    ):
        raise ValueError("Parquet sequence field is invalid")
    expected = ["sequence"]
    profile: dict[str, object] = {}
    if "timestamp_ns" in names:
        if schema.field("timestamp_ns") != pa.field(
            "timestamp_ns", pa.int64(), nullable=False
        ):
            raise ValueError("Parquet timestamp field is invalid")
        expected.append("timestamp_ns")
        profile["timestamp_unit"] = "ns"
    if "round" in names:
        if schema.field("round") != pa.field("round", pa.uint32(), nullable=False):
            raise ValueError("Parquet round field is invalid")
        expected.append("round")
        profile["round"] = True
    for name in ("detectors",) + PACKED_FIELDS:
        if name in names:
            expected.append(name)
            profile[name] = _packed_width(schema.field(name))
    if names != expected or "detectors" not in profile:
        raise ValueError("Parquet fields do not match the canonical syndrome schema")
    if schema_fingerprint(profile) != _metadata_text(schema, b"qec.schema_fingerprint"):
        raise ValueError("Parquet schema fingerprint is invalid")


def _validate_scientific_columns(table: pa.Table) -> None:
    table.validate(full=True)
    if "round" in table.column_names:
        rounds = table.column("round").to_pylist()
        if rounds != list(range(rounds[0], rounds[0] + len(rounds))):
            raise ValueError("Parquet round range is not contiguous")
    for name in ("detectors",) + PACKED_FIELDS:
        if name not in table.column_names:
            continue
        width = _packed_width(table.schema.field(name))
        for chunk in table.column(name).chunks:
            data_buffer = chunk.buffers()[1]
            if data_buffer is None:
                raise ValueError(f"Parquet field {name} has no scientific data")
            packed = PackedBits(width, data_buffer.to_pybytes())
            _validate_padding(name, packed, len(chunk))


def inspect_partition(path: Path, *, is_final: bool = False) -> PendingPartition:
    if path.is_symlink() or not path.is_file():
        raise ValueError("Parquet partition is not a regular file")
    try:
        metadata = pq.read_metadata(path)
        schema = pq.read_schema(path)
        if metadata.num_rows < 1 or metadata.num_rows > MAX_PARTITION_ROWS:
            raise ValueError("Parquet partition row count is outside canonical bounds")
        _validate_schema(schema)
        start = int(_metadata_text(schema, b"qec.sequence_start"))
        end = int(_metadata_text(schema, b"qec.sequence_end"))
        if start < 0 or end - start != metadata.num_rows:
            raise ValueError("Parquet sequence range does not match its footer")
        table = pq.read_table(path, page_checksum_verification=True)
        _validate_scientific_columns(table)
        sequence = table.column("sequence").to_pylist()
    except (OSError, pa.ArrowException, KeyError, ValueError) as error:
        if isinstance(error, ValueError) and str(error).startswith("Parquet"):
            raise
        raise ValueError("Parquet footer or schema is invalid") from error
    if sequence != list(range(start, end)):
        raise ValueError("Parquet sequence range does not match its footer")
    return PendingPartition(
        path=path,
        sha256=sha256_file(path),
        rows=metadata.num_rows,
        sequence_start=start,
        sequence_end=end,
        segment_id=_metadata_text(schema, b"qec.segment_id"),
        dataset_id=_metadata_text(schema, b"qec.dataset_id"),
        schema_fingerprint=_metadata_text(schema, b"qec.schema_fingerprint"),
        is_final=is_final,
    )
