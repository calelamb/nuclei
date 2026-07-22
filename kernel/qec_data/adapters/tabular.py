"""Explicitly mapped CSV, JSONL, Arrow, and Parquet QEC imports."""

from __future__ import annotations

import hashlib
import itertools
import math
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import Path

from kernel.qec_data.adapters.base import (
    CORE_CAPABILITIES,
    AdapterCapability,
    AdapterCommand,
    AdapterManifest,
    ImportChunk,
    ImportMapping,
    PreviewResult,
    ProbeResult,
    SourceSpan,
    SourceSpanPrecision,
    StreamConfig,
    ValidationIssue,
    ValidationReport,
    compute_source_sha256,
    unsupported,
)
from kernel.qec_data.models import (
    CalibrationBatch,
    CalibrationQuality,
    CalibrationRecord,
    CalibrationScope,
    CalibrationScopeKind,
    DataQualityFlag,
    IndexRange,
    PackedBits,
    QualifiedFloat,
    QualifiedPackedBits,
    QualifiedRange,
    QualifiedText,
    QualifiedTimestamps,
    SyndromeBatch,
    TimestampSeries,
    ValueStatus,
)
from kernel.qec_data.adapters.tabular_sources import (
    MAX_BATCH_RECORDS,
    MAX_CHUNK_BYTES,
    MAX_RECORD_BYTES,
    TABULAR_SUFFIXES,
    TabularSourceRow as _SourceRow,
    source_kind as _source_kind,
    source_rows as _source_rows,
)


SYNDROME_FIELDS = frozenset(
    {"sequence", "detector_events", "observable_events", "timestamp", "round"}
)
CALIBRATION_FIELDS = frozenset(
    {
        "calibration_id",
        "scope_kind",
        "scope_id",
        "parameter_name",
        "semantic_id",
        "value",
        "unit",
        "uncertainty",
        "value_status",
        "unit_status",
        "uncertainty_status",
        "quality",
        "source_system",
        "effective_start",
        "effective_end",
        "calibration_run_id",
        "original_representation",
        "original_mime_type",
    }
)
REQUIRED_CALIBRATION_FIELDS = frozenset(
    {
        "calibration_id",
        "scope_kind",
        "scope_id",
        "parameter_name",
        "semantic_id",
        "value",
        "unit",
        "uncertainty",
        "value_status",
        "unit_status",
        "uncertainty_status",
        "quality",
        "source_system",
        "effective_start",
    }
)


@dataclass(frozen=True, slots=True)
class _SyndromeRow:
    sequence: int
    detectors: bytes
    observables: bytes | None
    timestamp: float | None
    round_index: int | None
    source: _SourceRow


def _options(mapping: ImportMapping) -> dict[str, object]:
    return dict(mapping.options)


def _fields(mapping: ImportMapping) -> dict[str, str]:
    return dict(mapping.fields)


def _text_option(options: dict[str, object], name: str, fallback: str) -> str:
    value = options.get(name, fallback)
    if type(value) is not str or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _integer_option(options: dict[str, object], name: str) -> int:
    value = options.get(name)
    if type(value) is not int:
        raise ValueError(f"{name} must be an explicit integer")
    return value


def _output_kind(mapping: ImportMapping) -> str:
    value = _options(mapping).get("output_kind")
    if value not in {"syndromes", "calibration"}:
        raise ValueError("output_kind must explicitly be syndromes or calibration")
    return str(value)


def _validate_mapping(mapping: ImportMapping) -> None:
    fields = _fields(mapping)
    if not fields:
        raise ValueError("an explicit tabular field mapping is required")
    kind = _output_kind(mapping)
    if len(set(fields.values())) != len(fields):
        raise ValueError("mapped source columns must be unique")
    common_options = {"output_kind", "session_id", "segment_id"}
    if kind == "syndromes":
        if not {"sequence", "detector_events"}.issubset(fields):
            raise ValueError("syndrome mapping requires sequence and detector_events")
        if set(fields) - SYNDROME_FIELDS:
            raise ValueError("syndrome mapping contains an unsupported canonical field")
        options = _options(mapping)
        allowed_options = common_options | {
            "detector_count",
            "observable_count",
            "bit_order",
            "timestamp_unit",
        }
        if set(options) - allowed_options:
            raise ValueError("syndrome mapping contains an unsupported option")
        if _integer_option(options, "detector_count") < 1:
            raise ValueError("detector_count must be positive")
        if options.get("bit_order") != "lsb0":
            raise ValueError("bit_order must explicitly be lsb0")
        if "timestamp" in fields and not options.get("timestamp_unit"):
            raise ValueError("timestamp_unit is required when timestamp is mapped")
        if "observable_count" in options and "observable_events" not in fields:
            raise ValueError("observable_count requires observable_events mapping")
        if "observable_events" in fields:
            if _integer_option(options, "observable_count") < 1:
                raise ValueError("observable_count must be positive")
    else:
        if set(_options(mapping)) - common_options:
            raise ValueError("calibration mapping contains an unsupported option")
        missing = REQUIRED_CALIBRATION_FIELDS - set(fields)
        if missing or set(fields) - CALIBRATION_FIELDS:
            raise ValueError("calibration mapping is incomplete or unsupported")


def _column(row: _SourceRow, fields: dict[str, str], name: str) -> object:
    source_name = fields[name]
    values = dict(row.values)
    if source_name not in values:
        raise ValueError(f"mapped source column {source_name!r} is missing")
    return values[source_name]


def _exact_int(value: object, name: str) -> int:
    if type(value) is int:
        return value
    if type(value) is str:
        stripped = value.strip()
        if stripped.isascii() and (
            stripped.isdecimal()
            or (stripped.startswith("-") and stripped[1:].isdecimal())
        ):
            return int(stripped)
    raise ValueError(f"{name} must be an exact integer")


def _finite_number(value: object, name: str) -> float:
    if type(value) in {int, float}:
        number = float(value)
    elif type(value) is str:
        try:
            number = float(value.strip())
        except ValueError as error:
            raise ValueError(f"{name} must be a number") from error
    else:
        raise ValueError(f"{name} must be a number")
    if not math.isfinite(number):
        raise ValueError(f"{name} must be finite")
    return number


def _packed_bits(value: object, width: int, name: str) -> bytes:
    stride = (width + 7) // 8
    if type(value) is bytes:
        if len(value) != stride:
            raise ValueError(f"{name} packed byte width is invalid")
        if width % 8 and value[-1] & (0xFF ^ ((1 << (width % 8)) - 1)):
            raise ValueError(f"{name} has nonzero high padding bits")
        return value
    if (
        type(value) is not str
        or len(value) != width
        or any(bit not in "01" for bit in value)
    ):
        raise ValueError(f"{name} must be an explicit {width}-character bit string")
    packed = sum((bit == "1") << index for index, bit in enumerate(value))
    return packed.to_bytes(stride, "little")


def _mapped_syndrome(row: _SourceRow, mapping: ImportMapping) -> _SyndromeRow:
    fields = _fields(mapping)
    options = _options(mapping)
    observables = (
        _packed_bits(
            _column(row, fields, "observable_events"),
            _integer_option(options, "observable_count"),
            "observable_events",
        )
        if "observable_events" in fields
        else None
    )
    return _SyndromeRow(
        sequence=_exact_int(_column(row, fields, "sequence"), "sequence"),
        detectors=_packed_bits(
            _column(row, fields, "detector_events"),
            _integer_option(options, "detector_count"),
            "detector_events",
        ),
        observables=observables,
        timestamp=(
            _finite_number(_column(row, fields, "timestamp"), "timestamp")
            if "timestamp" in fields
            else None
        ),
        round_index=(
            _exact_int(_column(row, fields, "round"), "round")
            if "round" in fields
            else None
        ),
        source=row,
    )


def _source_span(rows: tuple[_SourceRow, ...], source_hash: str) -> SourceSpan:
    precision = rows[0].precision
    byte_ranges = (
        rows[0].byte_ranges
        if precision is SourceSpanPrecision.CONTAINER
        else (IndexRange(rows[0].byte_ranges[0].start, rows[-1].byte_ranges[-1].end),)
    )
    return SourceSpan(
        source_id=f"sha256:{source_hash}",
        byte_ranges=byte_ranges,
        row_range=IndexRange(rows[0].row_index, rows[-1].row_index + 1),
        precision=precision,
    )


def _mapped_source_rows(source: Path, mapping: ImportMapping) -> Iterator[_SourceRow]:
    columns = (
        None
        if _output_kind(mapping) == "calibration"
        else tuple(_fields(mapping).values())
    )
    return _source_rows(source, columns)


def _identity(source_hash: str, mapping: ImportMapping) -> str:
    if mapping.expected_provenance_id is not None:
        return mapping.expected_provenance_id
    digest = hashlib.sha256(
        b"tabular\0"
        + bytes.fromhex(source_hash)
        + repr((mapping.fields, mapping.options)).encode()
    ).hexdigest()
    return f"tabular:{digest}"


def _row_observables(
    rows: tuple[_SyndromeRow, ...], options: dict[str, object]
) -> QualifiedPackedBits:
    observable_count = options.get("observable_count")
    if observable_count is None:
        return QualifiedPackedBits(None, ValueStatus.ABSENT)
    packed = PackedBits(
        int(observable_count), b"".join(row.observables or b"" for row in rows)
    )
    return QualifiedPackedBits(packed, ValueStatus.MEASURED)


def _row_timestamps(
    rows: tuple[_SyndromeRow, ...], options: dict[str, object]
) -> QualifiedTimestamps:
    if rows[0].timestamp is None:
        return QualifiedTimestamps(None, ValueStatus.UNAVAILABLE)
    series = TimestampSeries(
        tuple(float(row.timestamp) for row in rows),
        _text_option(options, "timestamp_unit", ""),
    )
    return QualifiedTimestamps(series, ValueStatus.MEASURED)


def _row_rounds(rows: tuple[_SyndromeRow, ...]) -> QualifiedRange:
    if rows[0].round_index is None:
        return QualifiedRange(None, ValueStatus.UNKNOWN)
    if any(
        current.round_index != previous.round_index + 1
        for previous, current in zip(rows, rows[1:])
    ):
        raise ValueError("round values must be contiguous within a segment")
    value = IndexRange(int(rows[0].round_index), int(rows[-1].round_index) + 1)
    return QualifiedRange(value, ValueStatus.MEASURED)


def _syndrome_payload(
    rows: tuple[_SyndromeRow, ...],
    mapping: ImportMapping,
    source_hash: str,
    gap_before: bool,
) -> SyndromeBatch:
    options = _options(mapping)
    first_sequence = rows[0].sequence
    sequence_end = first_sequence + len(rows)
    detector_count = _integer_option(options, "detector_count")
    return SyndromeBatch(
        batch_id=f"tabular-syndromes-{first_sequence}-{sequence_end}",
        session_id=_text_option(options, "session_id", f"tabular-{source_hash[:12]}"),
        segment_id=_text_option(options, "segment_id", "segment-0"),
        sequence_start=first_sequence,
        sequence_end=sequence_end,
        record_count=len(rows),
        detector_events=PackedBits(
            detector_count, b"".join(row.detectors for row in rows)
        ),
        provenance_id=_identity(source_hash, mapping),
        shot_range=QualifiedRange(
            IndexRange(first_sequence, sequence_end), ValueStatus.MEASURED
        ),
        round_range=_row_rounds(rows),
        source_timestamps=_row_timestamps(rows, options),
        observables=_row_observables(rows, options),
        data_quality=(
            (DataQualityFlag.GAP_BEFORE,) if gap_before else (DataQualityFlag.COMPLETE,)
        ),
    )


def _syndrome_chunk(
    rows: tuple[_SyndromeRow, ...],
    mapping: ImportMapping,
    source_hash: str,
    gap_before: bool,
) -> ImportChunk:
    payload = _syndrome_payload(rows, mapping, source_hash, gap_before)
    source_rows = tuple(row.source for row in rows)
    return ImportChunk(payload, (_source_span(source_rows, source_hash),))


def _syndrome_chunks(
    source: Path, mapping: ImportMapping, source_hash: str
) -> Iterator[ImportChunk]:
    options = _options(mapping)
    byte_width = (_integer_option(options, "detector_count") + 7) // 8
    if "observable_events" in _fields(mapping):
        byte_width += (_integer_option(options, "observable_count") + 7) // 8
    batch_limit = max(1, min(MAX_BATCH_RECORDS, MAX_CHUNK_BYTES // max(1, byte_width)))
    group: list[_SyndromeRow] = []
    previous_sequence: int | None = None
    gap_before = False
    for source_row in _mapped_source_rows(source, mapping):
        row = _mapped_syndrome(source_row, mapping)
        if previous_sequence is not None and row.sequence <= previous_sequence:
            raise ValueError("sequence must be strictly monotonic")
        contiguous = previous_sequence is None or row.sequence == previous_sequence + 1
        if group and (not contiguous or len(group) >= batch_limit):
            yield _syndrome_chunk(tuple(group), mapping, source_hash, gap_before)
            group = []
            gap_before = not contiguous
        group.append(row)
        previous_sequence = row.sequence
    if group:
        yield _syndrome_chunk(tuple(group), mapping, source_hash, gap_before)


def _row_text(row: _SourceRow, fields: dict[str, str], name: str) -> str:
    value = _column(row, fields, name)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return str(value).strip()


def _row_optional(row: _SourceRow, fields: dict[str, str], name: str) -> str | None:
    value = _row_text(row, fields, name) if name in fields else ""
    return value or None


def _row_qualified_float(
    row: _SourceRow,
    fields: dict[str, str],
    value_name: str,
    status_name: str,
) -> QualifiedFloat:
    status = ValueStatus(_row_text(row, fields, status_name))
    raw = _column(row, fields, value_name)
    value = (
        None
        if raw is None or str(raw).strip() == ""
        else _finite_number(raw, value_name)
    )
    return QualifiedFloat(value, status)


def _calibration_record(
    row: _SourceRow, mapping: ImportMapping, source_hash: str
) -> CalibrationRecord:
    fields = _fields(mapping)
    options = _options(mapping)

    def text(name: str) -> str:
        return _row_text(row, fields, name)

    unit_status = ValueStatus(text("unit_status"))
    raw_unit = _column(row, fields, "unit")
    unit_value = (
        None
        if raw_unit is None or str(raw_unit).strip() == ""
        else str(raw_unit).strip()
    )
    original_representation = (
        text("original_representation")
        if "original_representation" in fields
        else row.original_representation
    )
    original_mime_type = (
        text("original_mime_type")
        if "original_mime_type" in fields
        else row.original_mime_type
    )
    return CalibrationRecord(
        calibration_id=text("calibration_id"),
        session_id=_text_option(options, "session_id", f"tabular-{source_hash[:12]}"),
        scope=CalibrationScope(
            CalibrationScopeKind(text("scope_kind")), text("scope_id")
        ),
        parameter_name=text("parameter_name"),
        semantic_id=text("semantic_id"),
        value=_row_qualified_float(row, fields, "value", "value_status"),
        unit=QualifiedText(unit_value, unit_status),
        uncertainty=_row_qualified_float(
            row, fields, "uncertainty", "uncertainty_status"
        ),
        quality=CalibrationQuality(text("quality")),
        source_system=text("source_system"),
        provenance_id=_identity(source_hash, mapping),
        effective_start=text("effective_start"),
        effective_end=_row_optional(row, fields, "effective_end"),
        calibration_run_id=_row_optional(row, fields, "calibration_run_id"),
        original_mime_type=original_mime_type,
        original_representation=original_representation,
    )


def _calibration_chunk(
    rows: tuple[_SourceRow, ...],
    mapping: ImportMapping,
    source_hash: str,
    sequence_start: int,
) -> ImportChunk:
    options = _options(mapping)
    records = tuple(_calibration_record(row, mapping, source_hash) for row in rows)
    sequence_end = sequence_start + len(rows)
    payload = CalibrationBatch(
        batch_id=f"tabular-calibrations-{sequence_start}-{sequence_end}",
        session_id=_text_option(options, "session_id", f"tabular-{source_hash[:12]}"),
        segment_id=_text_option(options, "segment_id", "calibrations"),
        sequence_start=sequence_start,
        sequence_end=sequence_end,
        record_count=len(rows),
        records=records,
        provenance_id=_identity(source_hash, mapping),
    )
    return ImportChunk(payload, (_source_span(rows, source_hash),))


def _calibration_chunks(
    source: Path, mapping: ImportMapping, source_hash: str
) -> Iterator[ImportChunk]:
    iterator = iter(_mapped_source_rows(source, mapping))
    sequence_start = 0
    group: list[_SourceRow] = []
    group_bytes = 0
    for row in iterator:
        row_bytes = len(row.original_representation.encode("utf-8"))
        if group and (
            len(group) >= MAX_BATCH_RECORDS or group_bytes + row_bytes > MAX_CHUNK_BYTES
        ):
            rows = tuple(group)
            yield _calibration_chunk(rows, mapping, source_hash, sequence_start)
            sequence_start += len(rows)
            group = []
            group_bytes = 0
        group.append(row)
        group_bytes += row_bytes
    if group:
        yield _calibration_chunk(tuple(group), mapping, source_hash, sequence_start)


def _chunks(source: Path, mapping: ImportMapping) -> Iterator[ImportChunk]:
    _validate_mapping(mapping)
    source_hash = compute_source_sha256(source)
    if _output_kind(mapping) == "syndromes":
        return _syndrome_chunks(source, mapping, source_hash)
    return _calibration_chunks(source, mapping, source_hash)


class TabularAdapter:
    manifest = AdapterManifest(
        id="tabular",
        version="1",
        capabilities=CORE_CAPABILITIES,
        source_kinds=tuple(sorted(set(TABULAR_SUFFIXES.values()))),
        output_kinds=("syndromes", "calibrations"),
    )

    def probe(self, source: Path) -> ProbeResult:
        source_hash = compute_source_sha256(source)
        try:
            source_kind = _source_kind(source)
        except ValueError:
            return ProbeResult(False, confidence=0.0, source_sha256=source_hash)
        return ProbeResult(True, source_kind, confidence=0.8, source_sha256=source_hash)

    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport:
        source_hash = compute_source_sha256(source)
        provenance_id = _identity(source_hash, mapping)
        try:
            _validate_mapping(mapping)
            found = False
            for chunk in _chunks(source, mapping):
                found = found or chunk.record_count > 0
            if not found:
                raise ValueError("tabular source contains no records")
        except (OSError, TypeError, ValueError) as error:
            message = str(error)
            if "explicit tabular field mapping" in message:
                code = "tabular_mapping_required"
            elif "timestamp_unit" in message:
                code = "tabular_unit_required"
            elif "observable_count requires" in message:
                code = "tabular_mapping_invalid"
            else:
                code = "tabular_invalid_data"
            return ValidationReport(
                False,
                (ValidationIssue(code, message),),
                source_sha256=source_hash,
                provenance_id=provenance_id,
            )
        return ValidationReport(
            True, source_sha256=source_hash, provenance_id=provenance_id
        )

    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        if type(limit) is not int or limit < 0:
            raise ValueError("preview limit must be a nonnegative integer")
        _validate_mapping(mapping)
        source_hash = compute_source_sha256(source)
        rows = iter(_mapped_source_rows(source, mapping))
        bounded_limit = min(
            limit, MAX_BATCH_RECORDS, MAX_CHUNK_BYTES // MAX_RECORD_BYTES
        )
        selected = tuple(itertools.islice(rows, bounded_limit))
        has_more = next(rows, None) is not None
        if not selected:
            batches: tuple[ImportChunk, ...] = ()
        elif _output_kind(mapping) == "calibration":
            batches = (_calibration_chunk(selected, mapping, source_hash, 0),)
        else:
            temp_rows = tuple(_mapped_syndrome(row, mapping) for row in selected)
            if any(
                current.sequence != previous.sequence + 1
                for previous, current in zip(temp_rows, temp_rows[1:])
            ):
                raise ValueError("preview contains a sequence gap; reduce the preview")
            batches = (_syndrome_chunk(temp_rows, mapping, source_hash, False),)
        return PreviewResult(
            batches=batches,
            truncated=has_more,
            total_records=None if has_more else len(selected),
            source_sha256=source_hash,
            provenance_id=_identity(source_hash, mapping),
        )

    def import_batches(
        self, source: Path, mapping: ImportMapping
    ) -> Iterator[ImportChunk]:
        return _chunks(source, mapping)

    async def stream_batches(self, config: StreamConfig):
        return unsupported(AdapterCapability.STREAM)

    async def command(self, command: AdapterCommand):
        return unsupported(AdapterCapability.COMMAND)
