"""Variant-aware canonical payload checks used by the adapter contract runner."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from kernel.qec_data.adapters.base import (
    ImportChunk,
    SourceSpan,
    SourceSpanPrecision,
)
from kernel.qec_data.model_codecs import (
    batch_from_mapping,
    batch_to_mapping,
    import_chunk_from_mapping,
    import_chunk_to_mapping,
)
from kernel.qec_data.model_validation import DataQualityFlag
from kernel.qec_data.models import IndexRange, SyndromeBatch


class FailureSink(Protocol):
    def add(self, code: str, message: str) -> None: ...


@dataclass(frozen=True, slots=True)
class _CanonicalImport:
    payload: object
    source_spans: tuple[SourceSpan, ...]


@dataclass(frozen=True, slots=True)
class _ExactRanges:
    bytes: tuple[IndexRange, ...]
    rows: tuple[IndexRange, ...]


@dataclass(frozen=True, slots=True)
class _ExactCursor:
    byte_range: IndexRange | None = None
    row_range: IndexRange | None = None


def _canonical_payload(value: object, failures: FailureSink):
    raw_payload = value.payload if type(value) is ImportChunk else value
    if not getattr(raw_payload, "provenance_id", None):
        failures.add("batch_provenance_absent", "batch omitted provenance identity")
    try:
        if type(value) is SyndromeBatch:
            canonical = _CanonicalImport(
                batch_from_mapping(batch_to_mapping(value)), ()
            )
        elif type(value) is ImportChunk:
            chunk = import_chunk_from_mapping(import_chunk_to_mapping(value))
            canonical = _CanonicalImport(chunk.payload, chunk.source_spans)
        else:
            failures.add("batch_type_invalid", "adapter yielded a non-canonical batch")
            return None
    except BaseException as error:
        failures.add("batch_canonical_invalid", f"{type(error).__name__}: {error}")
        return None
    return canonical


def _check_declared_kind(
    payload: object, output_kinds: tuple[str, ...], failures: FailureSink
) -> None:
    if getattr(payload, "record_kind", None) not in output_kinds:
        failures.add(
            "batch_output_kind_undeclared",
            "adapter yielded a canonical kind absent from its manifest",
        )


def _check_sequence(
    payload: object, previous: object | None, failures: FailureSink
) -> None:
    if previous is None:
        return
    if payload.sequence_start < previous.sequence_start:
        failures.add("batch_sequence_nonmonotonic", "batch sequence moved backwards")
    if payload.sequence_start < previous.sequence_end:
        failures.add("batch_sequence_overlap", "batch sequence ranges overlap")
    has_gap = payload.sequence_start > previous.sequence_end
    if type(payload) is not SyndromeBatch:
        if has_gap:
            failures.add("batch_sequence_gap", "batch sequence ranges contain a gap")
        return
    marks_gap = DataQualityFlag.GAP_BEFORE in payload.data_quality
    if has_gap and not marks_gap:
        failures.add("batch_sequence_gap", "batch sequence ranges contain a gap")
    if not has_gap and marks_gap:
        failures.add(
            "batch_sequence_false_gap", "GAP_BEFORE requires a sequence discontinuity"
        )


def _schema_profile(batch: SyndromeBatch) -> tuple[object, ...]:
    optional_bits = ("measurements", "observables", "erasures", "leakage", "heralds")
    packed = tuple(
        (value.value is not None, value.value.bit_width if value.value else None)
        for value in (getattr(batch, name) for name in optional_bits)
    )
    timestamps = batch.source_timestamps.value
    return (
        batch.detector_events.bit_width,
        packed,
        (timestamps is not None, timestamps.unit if timestamps else None),
        batch.round_range.value is not None,
    )


def _check_profile(
    batch: SyndromeBatch,
    profiles: dict[tuple[str, str], tuple[object, ...]],
    failures: FailureSink,
) -> None:
    key = batch.session_id, batch.segment_id
    profile = _schema_profile(batch)
    expected = profiles.setdefault(key, profile)
    if profile != expected:
        failures.add("batch_schema_profile_changed", "schema changed within a segment")
    if batch.detector_events.bit_width != expected[0]:
        failures.add("batch_width_changed", "detector width changed within a segment")


def _check_provenance(
    payload: object,
    provenance_id: str | None,
    expected_provenance_id: str | None,
    failures: FailureSink,
) -> None:
    if provenance_id and payload.provenance_id != provenance_id:
        failures.add(
            "batch_provenance_mismatch", "batch provenance mismatched validation"
        )
    if expected_provenance_id and payload.provenance_id != expected_provenance_id:
        failures.add(
            "batch_mapping_provenance_mismatch",
            "batch provenance mismatched the import mapping",
        )


def _append_ordered(
    values: list[IndexRange],
    current: IndexRange,
    failures: FailureSink,
    dimension: str,
) -> None:
    code = "source_span_exact" if dimension == "byte" else "source_span_exact_row"
    if values and current.start < values[-1].start:
        failures.add(
            f"{code}_nonmonotonic",
            f"exact source {dimension} ranges moved backwards within a chunk",
        )
    elif values and current.start < values[-1].end:
        failures.add(
            f"{code}_overlap",
            f"exact source {dimension} ranges overlap within a chunk",
        )
    values.append(current)


def _exact_ranges(
    spans: tuple[SourceSpan, ...], failures: FailureSink
) -> dict[str, _ExactRanges]:
    byte_groups: dict[str, list[IndexRange]] = {}
    row_groups: dict[str, list[IndexRange]] = {}
    for span in spans:
        if span.precision is not SourceSpanPrecision.EXACT:
            continue
        ranges = byte_groups.setdefault(span.source_id, [])
        for current in span.byte_ranges:
            _append_ordered(ranges, current, failures, "byte")
        if span.row_range is not None:
            rows = row_groups.setdefault(span.source_id, [])
            _append_ordered(rows, span.row_range, failures, "row")
    source_ids = byte_groups.keys() | row_groups.keys()
    return {
        source_id: _ExactRanges(
            tuple(byte_groups.get(source_id, ())),
            tuple(row_groups.get(source_id, ())),
        )
        for source_id in source_ids
    }


def _check_cursor(
    prior: IndexRange | None,
    first: IndexRange | None,
    failures: FailureSink,
    dimension: str,
) -> None:
    if prior is None or first is None:
        return
    code = "source_span_exact" if dimension == "byte" else "source_span_exact_row"
    if first.start < prior.start:
        failures.add(
            f"{code}_nonmonotonic",
            f"exact source {dimension} ranges moved backwards across chunks",
        )
    elif first.start < prior.end:
        failures.add(
            f"{code}_overlap",
            f"exact source {dimension} ranges overlap across chunks",
        )


def _check_exact_span_order(
    spans: tuple[SourceSpan, ...],
    context: tuple[str, str, str],
    previous: dict[tuple[str, str, str, str], _ExactCursor],
    failures: FailureSink,
) -> None:
    for source_id, ranges in _exact_ranges(spans, failures).items():
        key = (*context, source_id)
        prior = previous.get(key, _ExactCursor())
        first_byte = ranges.bytes[0] if ranges.bytes else None
        first_row = ranges.rows[0] if ranges.rows else None
        _check_cursor(prior.byte_range, first_byte, failures, "byte")
        _check_cursor(prior.row_range, first_row, failures, "row")
        previous[key] = _ExactCursor(
            ranges.bytes[-1] if ranges.bytes else prior.byte_range,
            ranges.rows[-1] if ranges.rows else prior.row_range,
        )


def check_batches(
    values: tuple[object, ...],
    provenance_id: str | None,
    expected_provenance_id: str | None,
    output_kinds: tuple[str, ...],
    failures: FailureSink,
) -> None:
    previous: dict[tuple[str, str, str], object] = {}
    profiles: dict[tuple[str, str], tuple[object, ...]] = {}
    exact_ranges: dict[tuple[str, str, str, str], _ExactCursor] = {}
    for value in values:
        canonical = _canonical_payload(value, failures)
        if canonical is None:
            continue
        payload = canonical.payload
        _check_declared_kind(payload, output_kinds, failures)
        key = payload.record_kind, payload.session_id, payload.segment_id
        _check_sequence(payload, previous.get(key), failures)
        previous[key] = payload
        if type(payload) is SyndromeBatch:
            _check_profile(payload, profiles, failures)
        _check_exact_span_order(canonical.source_spans, key, exact_ranges, failures)
        _check_provenance(payload, provenance_id, expected_provenance_id, failures)
