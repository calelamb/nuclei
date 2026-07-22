"""Variant-aware canonical payload checks used by the adapter contract runner."""

from __future__ import annotations

from typing import Protocol

from kernel.qec_data.adapters.base import ImportChunk
from kernel.qec_data.model_codecs import (
    batch_from_mapping,
    batch_to_mapping,
    import_chunk_from_mapping,
    import_chunk_to_mapping,
)
from kernel.qec_data.model_validation import DataQualityFlag
from kernel.qec_data.models import SyndromeBatch


class FailureSink(Protocol):
    def add(self, code: str, message: str) -> None: ...


def _canonical_payload(value: object, failures: FailureSink):
    raw_payload = value.payload if type(value) is ImportChunk else value
    if not getattr(raw_payload, "provenance_id", None):
        failures.add("batch_provenance_absent", "batch omitted provenance identity")
    try:
        if type(value) is SyndromeBatch:
            payload = batch_from_mapping(batch_to_mapping(value))
        elif type(value) is ImportChunk:
            payload = import_chunk_from_mapping(import_chunk_to_mapping(value)).payload
        else:
            failures.add("batch_type_invalid", "adapter yielded a non-canonical batch")
            return None
    except BaseException as error:
        failures.add("batch_canonical_invalid", f"{type(error).__name__}: {error}")
        return None
    return payload


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
    if type(payload) is not SyndromeBatch:
        return
    has_gap = payload.sequence_start > previous.sequence_end
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


def check_batches(
    values: tuple[object, ...],
    provenance_id: str | None,
    expected_provenance_id: str | None,
    output_kinds: tuple[str, ...],
    failures: FailureSink,
) -> None:
    previous: dict[tuple[str, str, str], object] = {}
    profiles: dict[tuple[str, str], tuple[object, ...]] = {}
    for value in values:
        payload = _canonical_payload(value, failures)
        if payload is None:
            continue
        _check_declared_kind(payload, output_kinds, failures)
        key = payload.record_kind, payload.session_id, payload.segment_id
        _check_sequence(payload, previous.get(key), failures)
        previous[key] = payload
        if type(payload) is SyndromeBatch:
            _check_profile(payload, profiles, failures)
        _check_provenance(payload, provenance_id, expected_provenance_id, failures)
