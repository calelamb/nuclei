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


def _arrow_rows(source: Path, source_kind: str) -> Iterator[TabularSourceRow]:
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as error:
        raise ValueError(
            "PyArrow is required to import Arrow or Parquet data"
        ) from error
    size = source.stat().st_size
    if size < 1:
        raise ValueError("Arrow or Parquet source is empty")
    container = (IndexRange(0, size),)
    if source_kind == "tabular-parquet":
        parquet = pq.ParquetFile(source, page_checksum_verification=True)
        try:
            batches = parquet.iter_batches(batch_size=MAX_BATCH_RECORDS)
            yield from _converted_arrow_rows(batches, container)
        finally:
            close = getattr(parquet, "close", None)
            if callable(close):
                close()
        return
    with pa.memory_map(str(source), "r") as mapped:
        try:
            reader = pa.ipc.open_file(mapped)
            batches = (
                reader.get_batch(index) for index in range(reader.num_record_batches)
            )
        except pa.ArrowInvalid:
            reader = pa.ipc.open_stream(mapped)
            batches = iter(reader)
        try:
            yield from _converted_arrow_rows(batches, container)
        finally:
            close = getattr(reader, "close", None)
            if callable(close):
                close()


def source_kind(source: Path) -> str:
    try:
        return TABULAR_SUFFIXES[source.suffix.lower()]
    except KeyError as error:
        raise ValueError(
            "tabular source must be CSV, JSONL, Arrow, or Parquet"
        ) from error


def source_rows(source: Path) -> Iterator[TabularSourceRow]:
    kind = source_kind(source)
    if kind == "tabular-csv":
        return _csv_rows(source)
    if kind == "tabular-jsonl":
        return _jsonl_rows(source)
    return _arrow_rows(source, kind)
