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
STIM_BASE_OPTIONS = frozenset(
    {
        "detector_count",
        "observable_count",
        "circuit_path",
        "dem_path",
        "session_id",
        "segment_id",
    }
)


class StimMeasurementTargetsUnsupported(ValueError):
    """Valid dets M# targets cannot fit the syndrome-only data model."""


class StimMappingUnsupported(ValueError):
    """The mapping includes configuration that this native adapter cannot use."""


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
    precision: SourceSpanPrecision = SourceSpanPrecision.EXACT


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


def _validated_options(mapping: ImportMapping, data_format: str) -> dict[str, object]:
    if mapping.fields:
        raise StimMappingUnsupported(
            "native Stim result import does not accept field mappings"
        )
    allowed = STIM_BASE_OPTIONS | ({"shot_count"} if data_format == "hits" else set())
    options = _pairs(mapping.options)
    unsupported_options = sorted(set(options) - allowed)
    if unsupported_options:
        names = ", ".join(unsupported_options)
        raise StimMappingUnsupported(f"unsupported Stim mapping option(s): {names}")
    if "circuit_path" in options and "dem_path" in options:
        raise StimMappingUnsupported(
            "circuit_path and dem_path are mutually exclusive Stim context options"
        )
    for name in ("session_id", "segment_id"):
        if name in options:
            _text_option(options, name, "")
    return options


def _resolve_widths(mapping: ImportMapping, data_format: str) -> _Widths:
    options = _validated_options(mapping, data_format)
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
    if observables is None:
        raise ValueError(
            "observable_count is required unless circuit_path or dem_path is provided"
        )
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
    precision: SourceSpanPrecision = SourceSpanPrecision.EXACT,
) -> _ShotRow:
    if any(index < 0 or index >= widths.total for index in positions):
        raise ValueError("Stim result contains a bit outside the declared widths")
    detectors, observables = _split_positions(positions, widths)
    return _ShotRow(detectors, observables, row_index, byte_start, byte_end, precision)


def _row_from_named_positions(
    detector_positions: frozenset[int],
    observable_positions: frozenset[int],
    widths: _Widths,
    row_index: int,
    byte_start: int,
    byte_end: int,
) -> _ShotRow:
    if any(
        index < 0 or index >= widths.detectors for index in detector_positions
    ) or any(
        index < 0 or index >= widths.observables for index in observable_positions
    ):
        raise ValueError(
            "Stim result contains a target outside the declared detector or observable width"
        )
    observables = (
        _packed_positions(observable_positions, widths.observables)
        if widths.observables
        else None
    )
    return _ShotRow(
        _packed_positions(detector_positions, widths.detectors),
        observables,
        row_index,
        byte_start,
        byte_end,
    )


def _row_from_packed(
    raw: bytes,
    widths: _Widths,
    byte_start: int,
    byte_end: int,
) -> _ShotRow:
    value = int.from_bytes(raw, "little")
    if value.bit_length() > widths.total:
        raise ValueError("b8 record has nonzero high padding bits")
    detector_mask = (1 << widths.detectors) - 1
    detector_bytes = (widths.detectors + 7) // 8
    observable_bytes = (widths.observables + 7) // 8
    detectors = (value & detector_mask).to_bytes(detector_bytes, "little")
    observables = (
        (value >> widths.detectors).to_bytes(observable_bytes, "little")
        if widths.observables
        else None
    )
    return _ShotRow(detectors, observables, None, byte_start, byte_end)


def _hits_shot_count(mapping: ImportMapping, data_format: str) -> int | None:
    if data_format != "hits":
        return None
    value = _integer_option(_pairs(mapping.options), "shot_count")
    if value is None:
        raise ValueError(
            "shot_count is required for hits because blank trailing lines are ambiguous"
        )
    if value < 0:
        raise ValueError("shot_count must be nonnegative")
    return value


def _text_rows(
    source: Path,
    widths: _Widths,
    data_format: str,
    shot_count: int | None,
) -> Iterator[_ShotRow]:
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
            if shot_count is not None and row_index >= shot_count:
                if line:
                    raise ValueError(
                        "hits contains nonblank data after declared shot_count"
                    )
                continue
            if data_format == "dets":
                detectors, observables = _parse_dets_positions(line)
                yield _row_from_named_positions(
                    detectors,
                    observables,
                    widths,
                    row_index,
                    byte_start,
                    byte_end,
                )
            else:
                positions = _parse_text_positions(line, widths, data_format)
                yield _row_from_positions(
                    positions, widths, row_index, byte_start, byte_end
                )
            row_index += 1
        if shot_count is not None and row_index != shot_count:
            raise ValueError("hits ended before the declared shot_count")


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
        return frozenset(int(term) for term in terms)
    raise ValueError(f"unsupported text Stim format: {data_format}")


def _parse_dets_positions(line: str) -> tuple[frozenset[int], frozenset[int]]:
    if line == "shot":
        return frozenset(), frozenset()
    if not line.startswith("shot ") or "  " in line:
        raise ValueError("dets records must start with 'shot'")
    detectors: set[int] = set()
    observables: set[int] = set()
    for term in line[5:].split(" "):
        if len(term) < 2 or term[0] not in "MDL" or not term[1:].isdecimal():
            raise ValueError("dets records require valid M#, D#, or L# targets")
        if term[0] == "M":
            raise StimMeasurementTargetsUnsupported(
                "M# is valid Stim dets syntax but raw measurements cannot be "
                "represented as syndrome detector events; use D#/L# "
                "detector-sampler output"
            )
        index = int(term[1:])
        if term[0] == "D":
            detectors.add(index)
        else:
            observables.add(index)
    return frozenset(detectors), frozenset(observables)


def _b8_rows(source: Path, widths: _Widths) -> Iterator[_ShotRow]:
    stride = (widths.total + 7) // 8
    with source.open("rb") as stream:
        while raw := stream.read(stride):
            byte_end = stream.tell()
            if len(raw) != stride:
                raise ValueError("b8 data ended in the middle of a record")
            yield _row_from_packed(raw, widths, byte_end - stride, byte_end)


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


def _transpose_8x8(planes: bytes) -> bytes:
    value = int.from_bytes(planes, "little")
    swap = (value ^ (value >> 7)) & 0x00AA00AA00AA00AA
    value = value ^ swap ^ (swap << 7)
    swap = (value ^ (value >> 14)) & 0x0000CCCC0000CCCC
    value = value ^ swap ^ (swap << 14)
    swap = (value ^ (value >> 28)) & 0x00000000F0F0F0F0
    return (value ^ swap ^ (swap << 28)).to_bytes(8, "little")


def _transpose_ptb64_range(
    raw: bytes, source_start: int, width: int
) -> tuple[bytes, ...]:
    rows = tuple(bytearray((width + 7) // 8) for _ in range(64))
    for output_byte, bit_offset in enumerate(range(0, width, 8)):
        plane_count = min(8, width - bit_offset)
        for shot_group in range(8):
            planes = bytes(
                raw[(source_start + bit_offset + plane) * 8 + shot_group]
                if plane < plane_count
                else 0
                for plane in range(8)
            )
            transposed = _transpose_8x8(planes)
            for shot_offset, packed in enumerate(transposed):
                rows[shot_group * 8 + shot_offset][output_byte] = packed
    return tuple(bytes(row) for row in rows)


def _ptb64_rows(source: Path, widths: _Widths) -> Iterator[_ShotRow]:
    block_size = widths.total * 8
    with source.open("rb") as stream:
        while raw := stream.read(block_size):
            byte_end = stream.tell()
            if len(raw) != block_size:
                raise ValueError("ptb64 data ended in the middle of a 64-shot block")
            byte_start = byte_end - block_size
            detector_rows = _transpose_ptb64_range(raw, 0, widths.detectors)
            observable_rows = (
                _transpose_ptb64_range(raw, widths.detectors, widths.observables)
                if widths.observables
                else None
            )
            for shot_index, detectors in enumerate(detector_rows):
                yield _ShotRow(
                    detectors,
                    observable_rows[shot_index] if observable_rows else None,
                    None,
                    byte_start,
                    byte_end,
                    SourceSpanPrecision.CONTAINER,
                )


def _rows(
    source: Path,
    widths: _Widths,
    mapping: ImportMapping,
    data_format: str,
) -> Iterator[_ShotRow]:
    if data_format in {"01", "hits", "dets"}:
        return _text_rows(
            source, widths, data_format, _hits_shot_count(mapping, data_format)
        )
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
    return SourceSpan(
        source_id=f"sha256:{source_hash}",
        byte_ranges=(IndexRange(rows[0].byte_start, rows[-1].byte_end),),
        row_range=row_range,
        precision=rows[0].precision,
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
    data_format = _format(source)
    _validated_options(mapping, data_format)
    source_hash = compute_source_sha256(source)
    widths = _resolve_widths(mapping, data_format)
    bytes_per_record = (widths.detectors + 7) // 8 + (
        (widths.observables + 7) // 8 if widths.observables else 0
    )
    batch_size = max(
        1,
        min(MAX_BATCH_RECORDS, MAX_CHUNK_BYTES // max(1, bytes_per_record)),
    )
    iterator = iter(_rows(source, widths, mapping, data_format))
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
        try:
            found = False
            for chunk in _chunks(source, mapping):
                found = found or chunk.record_count > 0
            if not found:
                raise ValueError("Stim result file contains no records")
        except (OSError, TypeError, ValueError) as error:
            if isinstance(error, StimMeasurementTargetsUnsupported):
                code = "stim_measurement_targets_unsupported"
            elif isinstance(error, StimMappingUnsupported):
                code = "stim_mapping_unsupported"
            elif "shot_count is required" in str(error):
                code = "stim_shot_count_required"
            elif "_count is required" in str(error):
                code = "stim_width_required"
            else:
                code = "stim_invalid_data"
            return ValidationReport(
                False,
                (ValidationIssue(code, str(error)),),
                source_sha256=source_hash,
                provenance_id=None,
            )
        provenance_id = _identity(source_hash, mapping, self.manifest.id)
        return ValidationReport(
            True, source_sha256=source_hash, provenance_id=provenance_id
        )

    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult:
        if type(limit) is not int or limit < 0:
            raise ValueError("preview limit must be a nonnegative integer")
        data_format = _format(source)
        _validated_options(mapping, data_format)
        source_hash = compute_source_sha256(source)
        provenance_id = _identity(source_hash, mapping, self.manifest.id)
        widths = _resolve_widths(mapping, data_format)
        bytes_per_record = (widths.detectors + 7) // 8 + (
            (widths.observables + 7) // 8 if widths.observables else 0
        )
        bounded_limit = min(
            limit,
            MAX_BATCH_RECORDS,
            max(1, MAX_CHUNK_BYTES // max(1, bytes_per_record)),
        )
        iterator = iter(_rows(source, widths, mapping, data_format))
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
