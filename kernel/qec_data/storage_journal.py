"""Strict versioned journal codecs and record-kind range rules."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .hashing import is_sha256, require_exact_keys
from .storage_lineage import (
    RECORD_KINDS,
    SYNDROMES,
    source_spans_from_value,
    source_spans_to_value,
)
from .storage_paths import validate_relative_path


JOURNAL_SCHEMA = "qec-storage-journal/2"
LEGACY_JOURNAL_SCHEMA = "qec-storage-journal/1"
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
JOURNAL_KEYS = frozenset(
    {
        "journal_schema",
        "session_id",
        "generation",
        "last_committed_sequence",
        "segments",
    }
)
SEGMENT_KEYS = frozenset(
    {"segment_id", "dataset_id", "record_kind", "schema_fingerprint", "partitions"}
)
LEGACY_PARTITION_KEYS = frozenset(
    {"path", "sha256", "rows", "sequence_start", "sequence_end"}
)
PARTITION_KEYS = LEGACY_PARTITION_KEYS | {"source_spans"}


def validate_identifier(value: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError("storage identifier is invalid")
    if value in {".", ".."} or "\\" in value:
        raise ValueError("storage identifier is invalid")
    return value


def partition_mapping(ref: Any) -> dict[str, object]:
    return {
        "path": ref.path.as_posix(),
        "sha256": ref.sha256,
        "rows": ref.rows,
        "sequence_start": ref.sequence_start,
        "sequence_end": ref.sequence_end,
        "source_spans": source_spans_to_value(ref.source_spans),
    }


def segment_mapping(refs: tuple[Any, ...]) -> dict[str, object]:
    first = refs[0]
    return {
        "segment_id": first.segment_id,
        "dataset_id": first.dataset_id,
        "record_kind": first.record_kind,
        "schema_fingerprint": first.schema_fingerprint,
        "partitions": [partition_mapping(ref) for ref in refs],
    }


def empty_journal(session_id: str) -> dict[str, object]:
    return {
        "journal_schema": JOURNAL_SCHEMA,
        "session_id": session_id,
        "generation": 0,
        "last_committed_sequence": None,
        "segments": [],
    }


def journal_segments(journal: Mapping[str, object]) -> list[dict[str, Any]]:
    segments = journal.get("segments")
    if not isinstance(segments, list) or not all(
        isinstance(item, dict) for item in segments
    ):
        raise ValueError("journal segments are invalid")
    return segments


def validate_journal(journal: object, session_id: str) -> dict[str, Any]:
    if not isinstance(journal, dict):
        raise ValueError("journal must be an object")
    require_exact_keys(journal, JOURNAL_KEYS, "journal")
    schema = journal.get("journal_schema")
    if schema not in {JOURNAL_SCHEMA, LEGACY_JOURNAL_SCHEMA}:
        raise ValueError("journal identity is invalid")
    if journal.get("session_id") != session_id:
        raise ValueError("journal identity is invalid")
    generation = journal.get("generation")
    if (
        not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < 0
    ):
        raise ValueError("journal generation is invalid")
    segments = journal_segments(journal)
    for segment in segments:
        _validate_segment(segment, schema == JOURNAL_SCHEMA)
    _validate_uniqueness(segments, journal.get("last_committed_sequence"))
    return journal


def ranges_overlap(left: Any, right: Any) -> bool:
    return (
        left.record_kind == right.record_kind
        and left.sequence_start < right.sequence_end
        and right.sequence_start < left.sequence_end
    )


def _validate_segment(segment: dict[str, Any], has_lineage: bool) -> None:
    require_exact_keys(segment, SEGMENT_KEYS, "journal segment")
    validate_identifier(segment.get("segment_id"))
    _validate_digest(segment.get("dataset_id"), "dataset ID")
    _validate_digest(segment.get("schema_fingerprint"), "schema fingerprint")
    if segment.get("record_kind") not in RECORD_KINDS:
        raise ValueError("journal record kind is invalid")
    if not has_lineage and segment.get("record_kind") != SYNDROMES:
        raise ValueError("legacy journal record kind must be syndromes")
    partitions = segment.get("partitions")
    if not isinstance(partitions, list):
        raise ValueError("journal partitions are invalid")
    for partition in partitions:
        _validate_partition(partition, has_lineage)


def _validate_digest(value: object, name: str) -> str:
    if not is_sha256(value):
        raise ValueError(f"journal {name} is invalid")
    return str(value)


def _validate_partition(value: object, has_lineage: bool) -> None:
    if not isinstance(value, dict):
        raise ValueError("journal partition is invalid")
    required = PARTITION_KEYS if has_lineage else LEGACY_PARTITION_KEYS
    require_exact_keys(value, required, "journal partition")
    validate_relative_path(value.get("path"))
    _validate_digest(value.get("sha256"), "partition hash")
    numbers = tuple(
        value.get(name) for name in ("rows", "sequence_start", "sequence_end")
    )
    if any(not isinstance(item, int) or isinstance(item, bool) for item in numbers):
        raise ValueError("journal partition range is invalid")
    rows, start, end = numbers
    if rows < 1 or start < 0 or end - start != rows:
        raise ValueError("journal partition range is invalid")
    if has_lineage:
        source_spans_from_value(value.get("source_spans"))


def _validate_uniqueness(segments: list[dict[str, Any]], last: object) -> None:
    keys = [(item["record_kind"], item["segment_id"]) for item in segments]
    paths = [item["path"] for segment in segments for item in segment["partitions"]]
    ranges = [
        (segment["record_kind"], item["sequence_start"], item["sequence_end"])
        for segment in segments
        for item in segment["partitions"]
    ]
    if len(keys) != len(set(keys)):
        raise ValueError("journal has duplicate segment IDs")
    if len(paths) != len(set(paths)):
        raise ValueError("journal has duplicate partition paths")
    for kind in RECORD_KINDS:
        ordered = sorted(
            (start, end) for item_kind, start, end in ranges if item_kind == kind
        )
        if any(right[0] < left[1] for left, right in zip(ordered, ordered[1:])):
            raise ValueError("journal partition ranges overlap")
    expected = max((end for _, _, end in ranges), default=None)
    expected = None if expected is None else expected - 1
    if last != expected:
        raise ValueError("journal last committed sequence is inconsistent")
