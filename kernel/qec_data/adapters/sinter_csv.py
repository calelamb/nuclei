"""Typed import of native sinter campaign statistics CSV files."""

from __future__ import annotations

import csv
import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
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
    StreamConfig,
    ValidationIssue,
    ValidationReport,
    compute_source_sha256,
    unsupported,
)
from kernel.qec_data.json_document import canonical_json_document
from kernel.qec_data.model_codecs import loads_canonical_json
from kernel.qec_data.models import (
    CampaignPointBatch,
    CampaignPointRecord,
    IndexRange,
)


MAX_BATCH_RECORDS = 65_536
MAX_RECORD_BYTES = 1_048_576
MAX_CHUNK_BYTES = 16 * 1_048_576
REQUIRED_COLUMNS = (
    "shots",
    "errors",
    "discards",
    "seconds",
    "decoder",
    "strong_id",
    "json_metadata",
)
OPTIONAL_COLUMNS = ("custom_counts",)
KNOWN_COLUMNS = frozenset((*REQUIRED_COLUMNS, *OPTIONAL_COLUMNS))
SINTER_OPTIONS = frozenset({"session_id", "segment_id"})


class SinterMappingUnsupported(ValueError):
    """The mapping includes configuration that native sinter CSV cannot use."""


@dataclass(frozen=True, slots=True)
class _CsvRow:
    values: tuple[tuple[str, str], ...]
    byte_start: int
    byte_end: int
    row_start: int
    row_end: int


class _TrackedBinaryLines:
    def __init__(self, source: Path) -> None:
        self._stream = source.open("rb")
        self.byte_end = 0
        self._record_bytes = 0

    def begin_record(self) -> None:
        self._record_bytes = 0

    def __iter__(self) -> _TrackedBinaryLines:
        return self

    def __next__(self) -> str:
        raw = self._stream.readline(MAX_RECORD_BYTES + 1)
        if not raw:
            raise StopIteration
        if len(raw) > MAX_RECORD_BYTES:
            raise ValueError("sinter CSV line exceeds the 1 MiB safety limit")
        self._record_bytes += len(raw)
        if self._record_bytes > MAX_RECORD_BYTES:
            raise ValueError("sinter CSV record exceeds the 1 MiB safety limit")
        self.byte_end += len(raw)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("CSV source must be UTF-8") from error

    def close(self) -> None:
        self._stream.close()


def _csv_rows(source: Path) -> Iterator[_CsvRow]:
    lines = _TrackedBinaryLines(source)
    try:
        reader = csv.reader(lines, strict=True)
        try:
            lines.begin_record()
            raw_header = next(reader)
        except StopIteration as error:
            raise ValueError("CSV source is empty") from error
        header = tuple(value.strip() for value in raw_header)
        if len(header) != len(set(header)):
            raise ValueError("CSV header contains duplicate columns")
        missing = set(REQUIRED_COLUMNS) - set(header)
        extra = set(header) - KNOWN_COLUMNS
        if missing or extra:
            raise ValueError(
                "required sinter columns are missing or unrecognized columns are present"
            )
        byte_start = lines.byte_end
        record_index = 1
        while True:
            lines.begin_record()
            try:
                raw_values = next(reader)
            except StopIteration:
                break
            if len(raw_values) != len(header):
                raise ValueError("sinter CSV row width does not match its header")
            yield _CsvRow(
                tuple(zip(header, raw_values, strict=True)),
                byte_start,
                lines.byte_end,
                record_index,
                record_index + 1,
            )
            byte_start = lines.byte_end
            record_index += 1
    except csv.Error as error:
        raise ValueError(f"sinter CSV is malformed: {error}") from error
    finally:
        lines.close()


def _integer(value: str, name: str) -> int:
    try:
        parsed = int(value.strip())
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error
    if str(parsed) != value.strip() and not (
        value.strip().startswith("+") and str(parsed) == value.strip()[1:]
    ):
        raise ValueError(f"{name} must use an integer representation")
    return parsed


def _number(value: str, name: str) -> float:
    try:
        return float(value.strip())
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error


def _canonical_json(value: str, name: str, default: object | None = None) -> str:
    stripped = value.strip()
    if not stripped and default is not None:
        return canonical_json_document(default)
    try:
        parsed = loads_canonical_json(stripped)
        return canonical_json_document(parsed)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be strict finite JSON: {error}") from error


def _record(row: _CsvRow) -> CampaignPointRecord:
    values = dict(row.values)
    return CampaignPointRecord(
        shots=_integer(values["shots"], "shots"),
        errors=_integer(values["errors"], "errors"),
        discards=_integer(values["discards"], "discards"),
        seconds=_number(values["seconds"], "seconds"),
        decoder=values["decoder"].strip(),
        strong_id=values["strong_id"].strip(),
        json_metadata=_canonical_json(values["json_metadata"], "json_metadata"),
        custom_counts=_canonical_json(
            values.get("custom_counts", ""), "custom_counts", {}
        ),
    )


def _options(mapping: ImportMapping) -> dict[str, object]:
    return dict(mapping.options)


def _text_option(options: dict[str, object], name: str, fallback: str) -> str:
    value = options.get(name, fallback)
    if type(value) is not str or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _validated_options(mapping: ImportMapping) -> dict[str, object]:
    if mapping.fields:
        raise SinterMappingUnsupported(
            "native sinter CSV does not accept field mappings"
        )
    options = _options(mapping)
    unsupported_options = sorted(set(options) - SINTER_OPTIONS)
    if unsupported_options:
        names = ", ".join(unsupported_options)
        raise SinterMappingUnsupported(
            f"unsupported native sinter CSV mapping option(s): {names}"
        )
    for name in SINTER_OPTIONS:
        if name in options:
            _text_option(options, name, "")
    return options


def _identity(source_hash: str, mapping: ImportMapping) -> str:
    if mapping.expected_provenance_id is not None:
        return mapping.expected_provenance_id
    digest = hashlib.sha256(
        b"sinter-csv\0"
        + bytes.fromhex(source_hash)
        + repr((mapping.fields, mapping.options)).encode()
    ).hexdigest()
    return f"sinter-csv:{digest}"


def _chunk(
    rows: tuple[_CsvRow, ...],
    mapping: ImportMapping,
    source_hash: str,
    sequence_start: int,
) -> ImportChunk:
    sequence_end = sequence_start + len(rows)
    options = _options(mapping)
    payload = CampaignPointBatch(
        batch_id=f"sinter-csv-{sequence_start}-{sequence_end}",
        session_id=_text_option(options, "session_id", f"sinter-{source_hash[:12]}"),
        segment_id=_text_option(options, "segment_id", "campaign-points"),
        sequence_start=sequence_start,
        sequence_end=sequence_end,
        record_count=len(rows),
        records=tuple(_record(row) for row in rows),
        provenance_id=_identity(source_hash, mapping),
    )
    span = SourceSpan(
        source_id=f"sha256:{source_hash}",
        byte_ranges=(IndexRange(rows[0].byte_start, rows[-1].byte_end),),
        row_range=IndexRange(rows[0].row_start, rows[-1].row_end),
    )
    return ImportChunk(payload=payload, source_spans=(span,))


def _chunks(source: Path, mapping: ImportMapping) -> Iterator[ImportChunk]:
    _validated_options(mapping)
    source_hash = compute_source_sha256(source)
    sequence_start = 0
    group: list[_CsvRow] = []
    group_bytes = 0
    for row in _csv_rows(source):
        row_bytes = row.byte_end - row.byte_start
        if group and (
            len(group) >= MAX_BATCH_RECORDS or group_bytes + row_bytes > MAX_CHUNK_BYTES
        ):
            rows = tuple(group)
            yield _chunk(rows, mapping, source_hash, sequence_start)
            sequence_start += len(rows)
            group = []
            group_bytes = 0
        group.append(row)
        group_bytes += row_bytes
    if group:
        yield _chunk(tuple(group), mapping, source_hash, sequence_start)


class SinterCsvAdapter:
    manifest = AdapterManifest(
        id="sinter-csv",
        version="1",
        capabilities=CORE_CAPABILITIES,
        source_kinds=("sinter-csv",),
        output_kinds=("campaign_points",),
    )

    def probe(self, source: Path) -> ProbeResult:
        source_hash = compute_source_sha256(source)
        if source.suffix.lower() != ".csv":
            return ProbeResult(False, confidence=0.0, source_sha256=source_hash)
        try:
            first = next(_csv_rows(source), None)
        except (OSError, TypeError, ValueError):
            return ProbeResult(False, confidence=0.0, source_sha256=source_hash)
        return ProbeResult(
            supported=first is not None,
            source_kind="sinter-csv" if first is not None else None,
            confidence=1.0 if first is not None else 0.0,
            source_sha256=source_hash,
        )

    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport:
        source_hash = compute_source_sha256(source)
        try:
            found = False
            for chunk in _chunks(source, mapping):
                found = found or chunk.record_count > 0
            if not found:
                raise ValueError("sinter CSV contains no campaign points")
        except (OSError, TypeError, ValueError) as error:
            code = (
                "sinter_mapping_unsupported"
                if isinstance(error, SinterMappingUnsupported)
                else "sinter_invalid_data"
            )
            return ValidationReport(
                False,
                (ValidationIssue(code, str(error)),),
                source_sha256=source_hash,
                provenance_id=None,
            )
        provenance_id = _identity(source_hash, mapping)
        return ValidationReport(
            True, source_sha256=source_hash, provenance_id=provenance_id
        )

    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        if type(limit) is not int or limit < 0:
            raise ValueError("preview limit must be a nonnegative integer")
        _validated_options(mapping)
        source_hash = compute_source_sha256(source)
        iterator = iter(_csv_rows(source))
        bounded_limit = min(limit, MAX_BATCH_RECORDS)
        selected: list[_CsvRow] = []
        selected_bytes = 0
        while len(selected) < bounded_limit:
            row = next(iterator, None)
            if row is None:
                break
            row_bytes = row.byte_end - row.byte_start
            if selected and selected_bytes + row_bytes > MAX_CHUNK_BYTES:
                break
            selected.append(row)
            selected_bytes += row_bytes
        rows = tuple(selected)
        has_more = next(iterator, None) is not None
        batches = (_chunk(rows, mapping, source_hash, 0),) if rows else ()
        return PreviewResult(
            batches=batches,
            truncated=has_more,
            total_records=None if has_more else len(rows),
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
