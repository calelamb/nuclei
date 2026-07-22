"""Fail-closed recovery classification for QEC Parquet sessions."""

from __future__ import annotations

import os
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .storage_parquet import PendingPartition, fsync_directory, inspect_partition
from .storage_paths import safe_session_file, secure_directory, walk_storage_files


@dataclass(frozen=True, slots=True)
class RecoveryIssue:
    path: Path
    message: str


@dataclass(frozen=True, slots=True)
class QuarantinedPartition:
    original_path: Path
    quarantine_path: Path
    reason: str


@dataclass(frozen=True, slots=True)
class RecoveryScan:
    resumable: tuple[PendingPartition, ...] = ()
    orphaned_final: tuple[PendingPartition, ...] = ()
    duplicates: tuple[PendingPartition, ...] = ()
    invalid_deleted: tuple[RecoveryIssue, ...] = ()
    quarantined: tuple[QuarantinedPartition, ...] = ()


def committed_refs(
    session_root: Path, journal: Mapping[str, Any]
) -> tuple[PendingPartition, ...]:
    generation = journal["generation"]
    return tuple(
        PendingPartition(
            safe_session_file(session_root, item["path"]),
            item["sha256"],
            item["rows"],
            item["sequence_start"],
            item["sequence_end"],
            segment["segment_id"],
            segment["dataset_id"],
            segment["schema_fingerprint"],
            True,
            generation,
        )
        for segment in journal["segments"]
        for item in segment["partitions"]
    )


def verify_committed(
    session_root: Path, journal: Mapping[str, Any]
) -> tuple[tuple[RecoveryIssue, ...], tuple[RecoveryIssue, ...]]:
    missing: list[RecoveryIssue] = []
    corrupt: list[RecoveryIssue] = []
    for expected in committed_refs(session_root, journal):
        if not expected.path.exists() and not expected.path.is_symlink():
            missing.append(
                RecoveryIssue(expected.path, "committed partition is missing")
            )
            continue
        try:
            actual = inspect_partition(expected.path, is_final=True)
            observed = replace(actual, journal_generation=expected.journal_generation)
            if observed != expected:
                raise ValueError("committed partition metadata differs from journal")
        except (ValueError, OSError) as error:
            corrupt.append(RecoveryIssue(expected.path, str(error)))
    return tuple(missing), tuple(corrupt)


def _overlap(left: PendingPartition, right: PendingPartition) -> bool:
    return (
        left.sequence_start < right.sequence_end
        and right.sequence_start < left.sequence_end
    )


def _exact_duplicate(left: PendingPartition, right: PendingPartition) -> bool:
    return (
        left.sequence_start == right.sequence_start
        and left.sequence_end == right.sequence_end
        and left.sha256 == right.sha256
    )


def _schema_identity(ref: PendingPartition) -> tuple[str, str]:
    return ref.schema_fingerprint, ref.dataset_id


def _inspect_pending(
    session_root: Path, generation: int
) -> tuple[list[PendingPartition], list[RecoveryIssue]]:
    valid: list[PendingPartition] = []
    invalid: list[RecoveryIssue] = []
    for path in walk_storage_files(session_root, "normalized", ".pending"):
        try:
            valid.append(
                replace(inspect_partition(path), journal_generation=generation)
            )
        except (ValueError, OSError) as error:
            path.unlink(missing_ok=True)
            fsync_directory(path.parent)
            invalid.append(RecoveryIssue(path, str(error)))
    return valid, invalid


def _inspect_orphans(
    session_root: Path,
    generation: int,
    committed_paths: frozenset[Path],
) -> tuple[list[PendingPartition], list[tuple[Path, str]]]:
    valid: list[PendingPartition] = []
    corrupt: list[tuple[Path, str]] = []
    for path in walk_storage_files(session_root, "normalized", ".parquet"):
        if path in committed_paths:
            continue
        try:
            inspected = inspect_partition(path, is_final=True)
            valid.append(replace(inspected, journal_generation=generation))
        except (ValueError, OSError) as error:
            corrupt.append((path, str(error)))
    return valid, corrupt


def _conflict_indexes(
    candidates: list[PendingPartition], committed: tuple[PendingPartition, ...]
) -> tuple[set[int], set[int]]:
    conflicts: set[int] = set()
    duplicates: set[int] = set()
    schemas = {ref.segment_id: _schema_identity(ref) for ref in committed}
    for index, candidate in enumerate(candidates):
        if (
            candidate.segment_id in schemas
            and _schema_identity(candidate) != schemas[candidate.segment_id]
        ):
            conflicts.add(index)
        for existing in committed:
            if _exact_duplicate(candidate, existing):
                duplicates.add(index)
            elif _overlap(candidate, existing):
                conflicts.add(index)
    _classify_candidate_pairs(candidates, conflicts, duplicates)
    return conflicts, duplicates - conflicts


def _classify_candidate_pairs(
    candidates: list[PendingPartition], conflicts: set[int], duplicates: set[int]
) -> None:
    for left_index, left in enumerate(candidates):
        for right_index in range(left_index + 1, len(candidates)):
            right = candidates[right_index]
            if not _exact_duplicate(left, right) and _overlap(left, right):
                conflicts.update((left_index, right_index))
            elif left.segment_id == right.segment_id and _schema_identity(
                left
            ) != _schema_identity(right):
                conflicts.update((left_index, right_index))
    for left_index, left in enumerate(candidates):
        for right_index in range(left_index + 1, len(candidates)):
            if (
                left_index not in conflicts
                and right_index not in conflicts
                and _exact_duplicate(left, candidates[right_index])
            ):
                duplicates.add(right_index)


def _quarantine(session_root: Path, path: Path, reason: str) -> QuarantinedPartition:
    directory = secure_directory(session_root, "quarantine")
    relative = path.relative_to(session_root)
    source = safe_session_file(session_root, relative.as_posix())
    target = safe_session_file(
        session_root, f"quarantine/{uuid.uuid4().hex}-{path.name}"
    )
    os.rename(source, target)
    fsync_directory(path.parent)
    fsync_directory(directory)
    return QuarantinedPartition(path, target, reason)


def scan_uncommitted(
    session_root: Path,
    generation: int,
    committed: tuple[PendingPartition, ...],
) -> RecoveryScan:
    pending, invalid = _inspect_pending(session_root, generation)
    orphans, corrupt_orphans = _inspect_orphans(
        session_root, generation, frozenset(ref.path for ref in committed)
    )
    candidates = sorted(pending + orphans, key=lambda ref: str(ref.path))
    conflicts, duplicates = _conflict_indexes(candidates, committed)
    quarantined = [
        _quarantine(session_root, candidates[index].path, "range or schema conflict")
        for index in sorted(conflicts)
    ]
    quarantined.extend(
        _quarantine(session_root, path, f"corrupt orphan final: {message}")
        for path, message in corrupt_orphans
    )
    accepted = [
        ref
        for index, ref in enumerate(candidates)
        if index not in conflicts and index not in duplicates
    ]
    return RecoveryScan(
        resumable=tuple(ref for ref in accepted if not ref.is_final),
        orphaned_final=tuple(ref for ref in accepted if ref.is_final),
        duplicates=tuple(candidates[index] for index in sorted(duplicates)),
        invalid_deleted=tuple(invalid),
        quarantined=tuple(quarantined),
    )
