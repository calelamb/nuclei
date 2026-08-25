"""Bounded row readers and lineage for tabular QEC adapters."""

from __future__ import annotations

import base64
import csv
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

from kernel.qec_data.adapters.base import SourceSpanPrecision
from kernel.qec_data.json_document import canonical_json_document
from kernel.qec_data.model_codecs import loads_canonical_json
from kernel.qec_data.models import IndexRange


MAX_BATCH_RECORDS = 65_536
MAX_RECORD_BYTES = 1_048_576
MAX_CHUNK_BYTES = 16 * 1_048_576
MAX_DECODE_BATCH_BYTES = 256 * 1_048_576
MAX_IPC_CONTAINER_BYTES = 256 * 1_048_576
MAX_PARQUET_CONTAINER_BYTES = 64 * 1_073_741_824
MAX_IPC_RECORD_BATCHES = 1_000_000
MAX_PARQUET_ROW_GROUPS = 1_000_000
MAX_SCHEMA_FIELDS = 4_096
TABULAR_SUFFIXES = {
    ".csv": "tabular-csv",
    ".jsonl": "tabular-jsonl",
    ".ndjson": "tabular-jsonl",
    ".parquet": "tabular-parquet",
    ".arrow": "tabular-arrow",
    ".feather": "tabular-arrow",
}


@dataclass(frozen=True, slots=True)
class TabularSourceRow:
    values: tuple[tuple[str, object], ...]
    byte_ranges: tuple[IndexRange, ...]
    row_index: int
    precision: SourceSpanPrecision
    original_representation: str
    original_mime_type: str


class _BoundedLines:
    def __init__(self, source: Path) -> None:
        self._stream = source.open("rb")
        self.byte_end = 0
        self._record_bytes = 0

    def begin_record(self) -> None:
        self._record_bytes = 0

    def __iter__(self) -> _BoundedLines:
        return self

    def __next__(self) -> str:
        raw = self._stream.readline(MAX_RECORD_BYTES + 1)
        if not raw:
            raise StopIteration
        if len(raw) > MAX_RECORD_BYTES:
            raise ValueError("tabular text line exceeds the 1 MiB safety limit")
        self._record_bytes += len(raw)
        if self._record_bytes > MAX_RECORD_BYTES:
            raise ValueError("tabular text record exceeds the 1 MiB safety limit")
        self.byte_end += len(raw)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("tabular text source must be UTF-8") from error

    def close(self) -> None:
        self._stream.close()


def _csv_rows(source: Path) -> Iterator[TabularSourceRow]:
    lines = _BoundedLines(source)
    try:
        reader = csv.reader(lines, strict=True)
        try:
            lines.begin_record()
            header = tuple(value.strip() for value in next(reader))
        except StopIteration as error:
            raise ValueError("tabular CSV is empty") from error
        if any(not name for name in header) or len(header) != len(set(header)):
            raise ValueError("tabular CSV header must contain unique nonempty columns")
        yield from _csv_data_rows(source, lines, reader, header)
    except csv.Error as error:
        raise ValueError(f"tabular CSV is malformed: {error}") from error
    finally:
        lines.close()


def _csv_data_rows(
    source: Path,
    lines: _BoundedLines,
    reader: Iterator[list[str]],
    header: tuple[str, ...],
) -> Iterator[TabularSourceRow]:
    byte_start = lines.byte_end
    record_index = 1
    with source.open("rb") as raw_source:
        while True:
            lines.begin_record()
            try:
                values = next(reader)
            except StopIteration:
                return
            if len(values) != len(header):
                raise ValueError("tabular CSV row width does not match its header")
            raw_source.seek(byte_start)
            raw_record = raw_source.read(lines.byte_end - byte_start)
            yield TabularSourceRow(
                tuple(zip(header, values, strict=True)),
                (IndexRange(byte_start, lines.byte_end),),
                record_index,
                SourceSpanPrecision.EXACT,
                raw_record.decode("utf-8"),
                "text/csv",
            )
            byte_start = lines.byte_end
            record_index += 1


def _jsonl_rows(source: Path) -> Iterator[TabularSourceRow]:
    with source.open("rb") as stream:
        row_index = 0
        while raw := stream.readline(MAX_RECORD_BYTES + 1):
            if len(raw) > MAX_RECORD_BYTES:
                raise ValueError("JSONL record exceeds the 1 MiB safety limit")
            byte_end = stream.tell()
            byte_start = byte_end - len(raw)
            try:
                document = raw.decode("utf-8").strip()
            except UnicodeDecodeError as error:
                raise ValueError("JSONL source must be UTF-8") from error
            if not document:
                raise ValueError("JSONL records must not be blank")
            parsed = loads_canonical_json(document)
            if not isinstance(parsed, Mapping):
                raise ValueError("each JSONL record must be an object")
            yield TabularSourceRow(
                tuple(parsed.items()),
                (IndexRange(byte_start, byte_end),),
                row_index,
                SourceSpanPrecision.EXACT,
                raw.decode("utf-8"),
                "application/x-ndjson",
            )
            row_index += 1


def _json_safe(value: object) -> object:
    if type(value) is bytes:
        return {
            "$type": "bytes",
            "base64": base64.b64encode(value).decode("ascii"),
        }
    if isinstance(value, datetime):
        return {"$type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"$type": "date", "value": value.isoformat()}
    if isinstance(value, time):
        return {"$type": "time", "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"$type": "decimal", "value": str(value)}
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _bounded_slices(batch: object) -> Iterator[object]:
    if batch.nbytes > MAX_DECODE_BATCH_BYTES:
        raise ValueError("decoded Arrow batch exceeds the 256 MiB safety limit")
    if batch.nbytes <= MAX_CHUNK_BYTES:
        yield batch
        return
    if batch.num_rows <= 1:
        raise ValueError("Arrow row exceeds the 16 MiB safety limit")
    midpoint = batch.num_rows // 2
    yield from _bounded_slices(batch.slice(0, midpoint))
    yield from _bounded_slices(batch.slice(midpoint))


def _converted_arrow_rows(
    batches: Iterator[object], container: tuple[IndexRange, ...]
) -> Iterator[TabularSourceRow]:
    row_index = 0
    for batch in batches:
        for bounded in _bounded_slices(batch):
            for values in bounded.to_pylist():
                if not isinstance(values, Mapping):
                    raise ValueError("Arrow rows must be objects")
                canonical_row = canonical_json_document(_json_safe(dict(values)))
                if len(canonical_row.encode("utf-8")) > MAX_RECORD_BYTES:
                    raise ValueError("Arrow row exceeds the 1 MiB safety limit")
                yield TabularSourceRow(
                    tuple(values.items()),
                    container,
                    row_index,
                    SourceSpanPrecision.CONTAINER,
                    canonical_row,
                    "application/json",
                )
                row_index += 1


def _container_size(source: Path, source_kind: str) -> int:
    size = source.stat().st_size
    if size < 1:
        raise ValueError("Arrow or Parquet source is empty")
    limit = (
        MAX_PARQUET_CONTAINER_BYTES
        if source_kind == "tabular-parquet"
        else MAX_IPC_CONTAINER_BYTES
    )
    if size > limit:
        label = "Parquet" if source_kind == "tabular-parquet" else "IPC"
        raise ValueError(f"{label} source exceeds the encoded container safety limit")
    return size


def _selected_fields(
    schema: object, columns: tuple[str, ...] | None
) -> tuple[tuple[str, ...], tuple[int, ...]]:
    names = tuple(schema.names)
    if len(names) > MAX_SCHEMA_FIELDS:
        raise ValueError("Arrow schema exceeds the field-count safety limit")
    seen: set[str] = set()
    duplicates: list[str] = []
    for name in names:
        if name in seen and name not in duplicates:
            duplicates.append(name)
        seen.add(name)
    if duplicates:
        joined = ", ".join(repr(name) for name in duplicates)
        raise ValueError(
            f"duplicate Arrow schema field names {joined} make projection ambiguous"
        )
    selected = names if columns is None else tuple(dict.fromkeys(columns))
    missing = tuple(name for name in selected if name not in names)
    if missing:
        raise ValueError(f"mapped Arrow columns are missing: {', '.join(missing)}")
    return selected, tuple(names.index(name) for name in selected)


def _close(value: object) -> None:
    close = getattr(value, "close", None)
    if callable(close):
        close()


def _validate_parquet_metadata(parquet: object, selected: tuple[str, ...]) -> None:
    # PyArrow 18 exposes column-chunk and row-group sizes, but not page sizes.
    # This is therefore the strongest supported check before page decode.
    metadata = parquet.metadata
    if metadata.num_row_groups > MAX_PARQUET_ROW_GROUPS:
        raise ValueError("Parquet row-group count exceeds the safety limit")
    selected_names = frozenset(selected)
    for group_index in range(metadata.num_row_groups):
        row_group = metadata.row_group(group_index)
        declared_bytes = 0
        for column_index in range(row_group.num_columns):
            column = row_group.column(column_index)
            if column.path_in_schema.split(".", 1)[0] not in selected_names:
                continue
            column_bytes = int(column.total_uncompressed_size)
            declared_bytes += column_bytes
            if column_bytes > MAX_DECODE_BATCH_BYTES:
                raise ValueError(
                    f"Parquet row group {group_index} metadata declares an "
                    "oversized selected column chunk"
                )
        if declared_bytes > MAX_DECODE_BATCH_BYTES:
            raise ValueError(
                f"Parquet row group {group_index} metadata declares too many "
                "uncompressed selected-column bytes"
            )


def _parquet_rows(
    source: Path,
    columns: tuple[str, ...] | None,
    container: tuple[IndexRange, ...],
    pa: object,
    pq: object,
) -> Iterator[TabularSourceRow]:
    arrow_source = _arrow_source(source, pa)
    parquet = pq.ParquetFile(arrow_source, page_checksum_verification=True)
    try:
        selected, _ = _selected_fields(parquet.schema_arrow, columns)
        _validate_parquet_metadata(parquet, selected)
        batches = parquet.iter_batches(
            batch_size=MAX_BATCH_RECORDS, columns=list(selected)
        )
        yield from _converted_arrow_rows(batches, container)
    finally:
        _close(parquet)
        _close(arrow_source)


def _arrow_source(source: Path, pa: object) -> object:
    if getattr(source, "is_capability_source", False):
        return pa.PythonFile(source.open("rb"), mode="r")
    return pa.memory_map(str(source), "r")


def _ipc_options(pa: object, schema: object, columns: tuple[str, ...] | None):
    _, indices = _selected_fields(schema, columns)
    return pa.ipc.IpcReadOptions(included_fields=list(indices))


def _preflight_ipc_stream(mapped: object, pa: object) -> None:
    mapped.seek(0)
    messages = pa.ipc.MessageReader.open_stream(mapped)
    record_batches = 0
    for message in messages:
        metadata_bytes = len(message.metadata) if message.metadata is not None else 0
        body_bytes = len(message.body) if message.body is not None else 0
        if metadata_bytes + body_bytes > MAX_DECODE_BATCH_BYTES:
            raise ValueError("IPC stream message exceeds the encoded safety limit")
        if message.type == "record batch":
            record_batches += 1
            if record_batches > MAX_IPC_RECORD_BATCHES:
                raise ValueError(
                    "IPC stream record batch count exceeds the safety limit"
                )


def _ipc_file_rows(
    mapped: object,
    reader: object,
    columns: tuple[str, ...] | None,
    container: tuple[IndexRange, ...],
    pa: object,
) -> Iterator[TabularSourceRow]:
    # The v18 file reader exposes footer batch counts but no per-batch body size.
    # The encoded file is capped before mmap; nbytes is capped after get_batch.
    try:
        if reader.num_record_batches > MAX_IPC_RECORD_BATCHES:
            raise ValueError("IPC file record batch count exceeds the safety limit")
        options = _ipc_options(pa, reader.schema, columns)
    finally:
        _close(reader)
    mapped.seek(0)
    projected = pa.ipc.open_file(mapped, options=options)
    try:
        batches = (
            projected.get_batch(index) for index in range(projected.num_record_batches)
        )
        yield from _converted_arrow_rows(batches, container)
    finally:
        _close(projected)


def _ipc_stream_rows(
    mapped: object,
    columns: tuple[str, ...] | None,
    container: tuple[IndexRange, ...],
    pa: object,
) -> Iterator[TabularSourceRow]:
    _preflight_ipc_stream(mapped, pa)
    mapped.seek(0)
    schema_reader = pa.ipc.open_stream(mapped)
    try:
        options = _ipc_options(pa, schema_reader.schema, columns)
    finally:
        _close(schema_reader)
    mapped.seek(0)
    projected = pa.ipc.open_stream(mapped, options=options)
    try:
        yield from _converted_arrow_rows(iter(projected), container)
    finally:
        _close(projected)


def _arrow_rows(
    source: Path, source_kind: str, columns: tuple[str, ...] | None
) -> Iterator[TabularSourceRow]:
    size = _container_size(source, source_kind)
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as error:
        raise ValueError(
            "PyArrow is required to import Arrow or Parquet data"
        ) from error
    container = (IndexRange(0, size),)
    if source_kind == "tabular-parquet":
        yield from _parquet_rows(source, columns, container, pa, pq)
        return
    with _arrow_source(source, pa) as mapped:
        try:
            reader = pa.ipc.open_file(mapped)
        except pa.ArrowInvalid:
            yield from _ipc_stream_rows(mapped, columns, container, pa)
        else:
            yield from _ipc_file_rows(mapped, reader, columns, container, pa)


def source_kind(source: Path) -> str:
    try:
        return TABULAR_SUFFIXES[source.suffix.lower()]
    except KeyError as error:
        raise ValueError(
            "tabular source must be CSV, JSONL, Arrow, or Parquet"
        ) from error


def source_rows(
    source: Path, columns: tuple[str, ...] | None = None
) -> Iterator[TabularSourceRow]:
    kind = source_kind(source)
    if kind == "tabular-csv":
        return _csv_rows(source)
    if kind == "tabular-jsonl":
        return _jsonl_rows(source)
    return _arrow_rows(source, kind, columns)
