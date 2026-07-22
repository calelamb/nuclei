"""Bounded offline import for Stim's documented shot-result formats."""

from __future__ import annotations

import hashlib
import itertools
import stat
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
    SourceSpanPrecision,
    StreamConfig,
    ValidationIssue,
    ValidationReport,
    compute_source_sha256,
    unsupported,
)
from kernel.qec_data.models import (
    IndexRange,
    PackedBits,
    QualifiedPackedBits,
    QualifiedRange,
    SyndromeBatch,
    ValueStatus,
)


MAX_BATCH_RECORDS = 65_536
MAX_RECORD_BYTES = 1_048_576
MAX_CHUNK_BYTES = 16 * 1_048_576
STIM_FORMATS = frozenset({"01", "b8", "r8", "ptb64", "hits", "dets"})


@dataclass(frozen=True, slots=True)
class _Widths:
    detectors: int
    observables: int

    @property
    def total(self) -> int:
        return self.detectors + self.observables


@dataclass(frozen=True, slots=True)
class _ShotRow:
    detectors: bytes
    observables: bytes | None
    row_index: int | None
    byte_start: int
    byte_end: int


def _pairs(value: tuple[tuple[str, object], ...]) -> dict[str, object]:
    return dict(value)


def _integer_option(options: dict[str, object], name: str) -> int | None:
    value = options.get(name)
    if value is None:
        return None
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer")
    return value


def _text_option(options: dict[str, object], name: str, fallback: str) -> str:
    value = options.get(name, fallback)
    if type(value) is not str or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _safe_context_path(raw_path: object) -> Path:
    if type(raw_path) is not str or not raw_path.strip():
        raise ValueError("Stim context path must be a non-empty string")
    path = Path(raw_path)
    try:
        status = path.lstat()
    except OSError as error:
        raise ValueError("Stim context file cannot be inspected") from error
    if stat.S_ISLNK(status.st_mode) or not stat.S_ISREG(status.st_mode):
        raise ValueError("Stim context must be a regular file, not a symlink")
    return path


def _context_widths(options: dict[str, object]) -> _Widths | None:
    context_key = next(
        (name for name in ("circuit_path", "dem_path") if name in options), None
    )
    if context_key is None:
        return None
    try:
        import stim
    except ImportError as error:
        raise ValueError(
            "Stim is required to read detector widths from .stim or .dem context"
        ) from error
    path = _safe_context_path(options[context_key])
    try:
        context = (
            stim.Circuit.from_file(path)
            if context_key == "circuit_path"
            else stim.DetectorErrorModel.from_file(path)
        )
    except (OSError, ValueError) as error:
        raise ValueError("Stim context file is invalid") from error
    return _Widths(
        detectors=int(context.num_detectors),
        observables=int(context.num_observables),
    )


def _resolve_widths(mapping: ImportMapping) -> _Widths:
    options = _pairs(mapping.options)
    context = _context_widths(options)
    detectors = _integer_option(options, "detector_count")
    observables = _integer_option(options, "observable_count")
    if detectors is None and context is not None:
        detectors = context.detectors
    if observables is None and context is not None:
        observables = context.observables
    if detectors is None:
        raise ValueError(
            "detector_count is required unless circuit_path or dem_path is provided"
        )
    observables = 0 if observables is None else observables
    if detectors < 1:
        raise ValueError("detector_count must be positive")
    if observables < 0:
        raise ValueError("observable_count cannot be negative")
    if context is not None and (
        detectors != context.detectors or observables != context.observables
    ):
        raise ValueError("explicit widths disagree with the Stim context")
    if (detectors + observables + 7) // 8 > MAX_RECORD_BYTES:
        raise ValueError("Stim record width exceeds the 1 MiB safety limit")
    return _Widths(detectors, observables)


def _format(source: Path) -> str:
    data_format = source.suffix.lower().removeprefix(".")
    if data_format not in STIM_FORMATS:
        raise ValueError(
            "Stim result extension must be 01, b8, r8, ptb64, hits, or dets"
        )
    return data_format


def _packed_positions(positions: frozenset[int], width: int) -> bytes:
    value = sum(1 << index for index in positions)
    return value.to_bytes((width + 7) // 8, "little")


def _split_positions(
    positions: frozenset[int], widths: _Widths
) -> tuple[bytes, bytes | None]:
    detectors = frozenset(index for index in positions if index < widths.detectors)
    observables = frozenset(
        index - widths.detectors for index in positions if index >= widths.detectors
    )
    packed_observables = (
        _packed_positions(observables, widths.observables)
        if widths.observables
        else None
    )
    return _packed_positions(detectors, widths.detectors), packed_observables


def _row_from_positions(
    positions: frozenset[int],
    widths: _Widths,
    row_index: int | None,
    byte_start: int,
    byte_end: int,
) -> _ShotRow:
    if any(index < 0 or index >= widths.total for index in positions):
        raise ValueError("Stim result contains a bit outside the declared widths")
    detectors, observables = _split_positions(positions, widths)
    return _ShotRow(detectors, observables, row_index, byte_start, byte_end)


def _text_rows(source: Path, widths: _Widths, data_format: str) -> Iterator[_ShotRow]:
    with source.open("rb") as stream:
        row_index = 0
        while raw_line := stream.readline(MAX_RECORD_BYTES + 1):
            if len(raw_line) > MAX_RECORD_BYTES:
                raise ValueError(f"{data_format} record exceeds the 1 MiB safety limit")
            byte_end = stream.tell()
            byte_start = byte_end - len(raw_line)
            if not raw_line.endswith(b"\n"):
                raise ValueError(f"{data_format} records must end with a newline")
            try:
                line = raw_line[:-1].decode("ascii")
            except UnicodeDecodeError as error:
                raise ValueError(f"{data_format} data must be ASCII") from error
            positions = _parse_text_positions(line, widths, data_format)
            yield _row_from_positions(
                positions, widths, row_index, byte_start, byte_end
            )
            row_index += 1


def _parse_text_positions(
    line: str, widths: _Widths, data_format: str
) -> frozenset[int]:
    if data_format == "01":
        if len(line) != widths.total or any(
            character not in "01" for character in line
        ):
            raise ValueError("01 record width or bit characters are invalid")
        return frozenset(
            index for index, character in enumerate(line) if character == "1"
        )
    if data_format == "hits":
        if not line:
            return frozenset()
        terms = line.split(",")
        if any(not term.isascii() or not term.isdecimal() for term in terms):
            raise ValueError("hits records must contain comma-separated integers")
        toggled: frozenset[int] = frozenset()
        for term in terms:
            index = int(term)
            toggled = toggled ^ frozenset({index})
        return toggled
    if line == "shot":
        return frozenset()
    if not line.startswith("shot ") or "  " in line:
        raise ValueError("dets records must start with 'shot'")
    positions: set[int] = set()
    for term in line[5:].split(" "):
        if len(term) < 2 or term[0] not in "DL" or not term[1:].isdecimal():
            raise ValueError("dets records may contain only D# and L# targets")
        index = int(term[1:])
        positions.add(index if term[0] == "D" else widths.detectors + index)
    return frozenset(positions)


def _b8_rows(source: Path, widths: _Widths) -> Iterator[_ShotRow]:
    stride = (widths.total + 7) // 8
    mask = (1 << widths.total) - 1
    with source.open("rb") as stream:
        while raw := stream.read(stride):
            byte_end = stream.tell()
            if len(raw) != stride:
                raise ValueError("b8 data ended in the middle of a record")
            unmasked = int.from_bytes(raw, "little")
            if unmasked & ~mask:
                raise ValueError("b8 record has nonzero high padding bits")
            value = unmasked
            positions = frozenset(
                index for index in range(widths.total) if value & (1 << index)
            )
            yield _row_from_positions(
                positions, widths, None, byte_end - stride, byte_end
            )


def _r8_rows(source: Path, widths: _Widths) -> Iterator[_ShotRow]:
    with source.open("rb") as stream:
        positions: frozenset[int] = frozenset()
        cursor = 0
        byte_start = 0
        while raw := stream.read(1):
            run = raw[0]
            cursor += run
            if run == 255:
                continue
            if cursor > widths.total:
                raise ValueError("r8 run extends beyond the declared record width")
            if cursor == widths.total:
                byte_end = stream.tell()
                yield _row_from_positions(positions, widths, None, byte_start, byte_end)
                positions = frozenset()
                cursor = 0
                byte_start = byte_end
                continue
            positions = positions | frozenset({cursor})
            cursor += 1
        if cursor or positions:
            raise ValueError("r8 data ended in the middle of a record")


def _ptb64_rows(source: Path, widths: _Widths) -> Iterator[_ShotRow]:
    block_size = widths.total * 8
    with source.open("rb") as stream:
        while raw := stream.read(block_size):
            byte_end = stream.tell()
            if len(raw) != block_size:
                raise ValueError("ptb64 data ended in the middle of a 64-shot block")
            byte_start = byte_end - block_size
            for shot_index in range(64):
                positions = frozenset(
                    bit_index
                    for bit_index in range(widths.total)
                    if raw[bit_index * 8 + shot_index // 8] & (1 << (shot_index % 8))
                )
                yield _row_from_positions(positions, widths, None, byte_start, byte_end)


def _rows(source: Path, widths: _Widths) -> Iterator[_ShotRow]:
    data_format = _format(source)
    if data_format in {"01", "hits", "dets"}:
        return _text_rows(source, widths, data_format)
    if data_format == "b8":
        return _b8_rows(source, widths)
    if data_format == "r8":
        return _r8_rows(source, widths)
    return _ptb64_rows(source, widths)


def _identity(source_hash: str, mapping: ImportMapping, adapter_id: str) -> str:
    if mapping.expected_provenance_id is not None:
        return mapping.expected_provenance_id
    digest = hashlib.sha256()
    digest.update(adapter_id.encode())
    digest.update(bytes.fromhex(source_hash))
    digest.update(repr((mapping.fields, mapping.options)).encode())
    return f"{adapter_id}:{digest.hexdigest()}"


def _payload(
    rows: tuple[_ShotRow, ...],
    mapping: ImportMapping,
    source_hash: str,
    sequence_start: int,
    widths: _Widths,
) -> SyndromeBatch:
    options = _pairs(mapping.options)
    sequence_end = sequence_start + len(rows)
    provenance_id = _identity(source_hash, mapping, "stim-results")
    observables = (
        QualifiedPackedBits(
            PackedBits(
                widths.observables,
                b"".join(row.observables or b"" for row in rows),
            ),
            ValueStatus.MEASURED,
        )
        if widths.observables
        else QualifiedPackedBits(None, ValueStatus.ABSENT)
    )
    return SyndromeBatch(
        batch_id=f"stim-results-{sequence_start}-{sequence_end}",
        session_id=_text_option(options, "session_id", f"stim-{source_hash[:12]}"),
        segment_id=_text_option(options, "segment_id", "segment-0"),
        sequence_start=sequence_start,
        sequence_end=sequence_end,
        record_count=len(rows),
        detector_events=PackedBits(
            widths.detectors, b"".join(row.detectors for row in rows)
        ),
        provenance_id=provenance_id,
        shot_range=QualifiedRange(
            IndexRange(sequence_start, sequence_end), ValueStatus.MEASURED
        ),
        observables=observables,
    )


def _source_span(rows: tuple[_ShotRow, ...], source_hash: str) -> SourceSpan:
    row_indices = tuple(row.row_index for row in rows)
    row_range = (
        IndexRange(int(row_indices[0]), int(row_indices[-1]) + 1)
        if row_indices[0] is not None
        else None
    )
    overlapping = any(
        current.byte_start < previous.byte_end
        for previous, current in zip(rows, rows[1:])
    )
    return SourceSpan(
        source_id=f"sha256:{source_hash}",
        byte_ranges=(IndexRange(rows[0].byte_start, rows[-1].byte_end),),
        row_range=row_range,
        precision=(
            SourceSpanPrecision.CONTAINER if overlapping else SourceSpanPrecision.EXACT
        ),
    )


def _chunk(
    rows: tuple[_ShotRow, ...],
    mapping: ImportMapping,
    source_hash: str,
    sequence_start: int,
    widths: _Widths,
) -> ImportChunk:
    payload = _payload(rows, mapping, source_hash, sequence_start, widths)
    return ImportChunk(payload=payload, source_spans=(_source_span(rows, source_hash),))


def _chunks(source: Path, mapping: ImportMapping) -> Iterator[ImportChunk]:
    source_hash = compute_source_sha256(source)
    widths = _resolve_widths(mapping)
    bytes_per_record = (widths.detectors + 7) // 8 + (
        (widths.observables + 7) // 8 if widths.observables else 0
    )
    batch_size = max(
        1,
        min(MAX_BATCH_RECORDS, MAX_CHUNK_BYTES // max(1, bytes_per_record)),
    )
    iterator = iter(_rows(source, widths))
    sequence_start = 0
    while records := tuple(itertools.islice(iterator, batch_size)):
        yield _chunk(records, mapping, source_hash, sequence_start, widths)
        sequence_start += len(records)


class StimResultsAdapter:
    manifest = AdapterManifest(
        id="stim-results",
        version="1",
        capabilities=CORE_CAPABILITIES,
        source_kinds=tuple(f"stim-{name}" for name in sorted(STIM_FORMATS)),
        output_kinds=("syndromes",),
    )

    def probe(self, source: Path) -> ProbeResult:
        source_hash = compute_source_sha256(source)
        try:
            data_format = _format(source)
        except ValueError:
            return ProbeResult(False, confidence=0.0, source_sha256=source_hash)
        return ProbeResult(
            True,
            source_kind=f"stim-{data_format}",
            confidence=1.0,
            source_sha256=source_hash,
        )

    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport:
        source_hash = compute_source_sha256(source)
        provenance_id = _identity(source_hash, mapping, self.manifest.id)
        try:
            found = False
            for chunk in _chunks(source, mapping):
                found = found or chunk.record_count > 0
            if not found:
                raise ValueError("Stim result file contains no records")
        except (OSError, TypeError, ValueError) as error:
            code = (
                "stim_width_required"
                if "detector_count is required" in str(error)
                else "stim_invalid_data"
            )
            return ValidationReport(
                False,
                (ValidationIssue(code, str(error)),),
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
        source_hash = compute_source_sha256(source)
        provenance_id = _identity(source_hash, mapping, self.manifest.id)
        widths = _resolve_widths(mapping)
        bytes_per_record = (widths.detectors + 7) // 8 + (
            (widths.observables + 7) // 8 if widths.observables else 0
        )
        bounded_limit = min(
            limit,
            MAX_BATCH_RECORDS,
            max(1, MAX_CHUNK_BYTES // max(1, bytes_per_record)),
        )
        iterator = iter(_rows(source, widths))
        records = tuple(itertools.islice(iterator, bounded_limit))
        has_more = next(iterator, None) is not None
        batches = (_chunk(records, mapping, source_hash, 0, widths),) if records else ()
        return PreviewResult(
            batches=batches,
            truncated=has_more,
            total_records=None if has_more else len(records),
            source_sha256=source_hash,
            provenance_id=provenance_id,
        )

    def import_batches(
        self, source: Path, mapping: ImportMapping
    ) -> Iterator[ImportChunk]:
        return _chunks(source, mapping)

    async def stream_batches(self, config: StreamConfig):
        return unsupported(AdapterCapability.STREAM)

    async def command(self, command: AdapterCommand):
        return unsupported(AdapterCapability.COMMAND)
