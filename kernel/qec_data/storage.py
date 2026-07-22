"""Crash-safe Parquet storage for canonical QEC syndrome sessions."""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import uuid
import weakref
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .hashing import (
    DatasetSemanticIdentity,
    canonical_json_bytes,
    dataset_id,
    is_sha256,
    require_exact_keys,
)
from .model_codecs import loads_canonical_json, session_from_mapping, session_to_mapping
from .models import SessionRecord, SyndromeBatch
from .storage_parquet import (
    RECORD_KIND,
    PendingPartition,
    fsync_directory,
    inspect_partition,
    packed_profile,
    schema_fingerprint,
    validate_batch_padding,
    write_pending,
)
from .storage_paths import (
    assert_session_root,
    require_storage_root,
    safe_session_file,
    secure_directory,
    validate_relative_path,
    walk_storage_files,
)
from .storage_recovery import (
    QuarantinedPartition,
    RecoveryIssue,
    committed_refs,
    scan_uncommitted,
    verify_committed,
)


JOURNAL_SCHEMA = "qec-storage-journal/1"
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
PARTITION_KEYS = frozenset({"path", "sha256", "rows", "sequence_start", "sequence_end"})


@dataclass(frozen=True, slots=True)
class PartitionRef:
    path: Path
    sha256: str
    rows: int
    sequence_start: int
    sequence_end: int


@dataclass(frozen=True, slots=True)
class SequenceGap:
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class RecoveryReport:
    resumable: tuple[PendingPartition, ...] = ()
    invalid_deleted: tuple[RecoveryIssue, ...] = ()
    orphaned_final: tuple[PendingPartition, ...] = ()
    missing_committed: tuple[RecoveryIssue, ...] = ()
    corrupt_committed: tuple[RecoveryIssue, ...] = ()
    duplicates: tuple[PendingPartition, ...] = ()
    quarantined: tuple[QuarantinedPartition, ...] = ()
    sequence_gaps: tuple[SequenceGap, ...] = ()
    fatal_error: str | None = None


@dataclass(frozen=True, slots=True)
class VerificationReport:
    ok: bool
    missing_committed: tuple[RecoveryIssue, ...] = ()
    corrupt_committed: tuple[RecoveryIssue, ...] = ()
    fatal_error: str | None = None


_LOCKS_GUARD = threading.Lock()
_SESSION_LOCKS: weakref.WeakValueDictionary[str, threading.RLock] = (
    weakref.WeakValueDictionary()
)


def _session_lock(path: str) -> threading.RLock:
    with _LOCKS_GUARD:
        lock = _SESSION_LOCKS.get(path)
        if lock is None:
            lock = threading.RLock()
            _SESSION_LOCKS[path] = lock
        return lock


def _validate_identifier(value: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError("storage identifier is invalid")
    if value in {".", ".."} or "\\" in value:
        raise ValueError("storage identifier is invalid")
    return value


def _write_durable(path: Path, content: bytes, *, exclusive: bool) -> None:
    mode = "xb" if exclusive else "wb"
    with path.open(mode) as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())


def _write_json(path: Path, value: object, *, exclusive: bool) -> None:
    _write_durable(path, canonical_json_bytes(value) + b"\n", exclusive=exclusive)


def _partition_mapping(ref: PendingPartition) -> dict[str, object]:
    return {
        "path": ref.path.as_posix(),
        "sha256": ref.sha256,
        "rows": ref.rows,
        "sequence_start": ref.sequence_start,
        "sequence_end": ref.sequence_end,
    }


def _segment_mapping(refs: tuple[PendingPartition, ...]) -> dict[str, object]:
    first = refs[0]
    return {
        "segment_id": first.segment_id,
        "dataset_id": first.dataset_id,
        "record_kind": RECORD_KIND,
        "schema_fingerprint": first.schema_fingerprint,
        "partitions": [_partition_mapping(ref) for ref in refs],
    }


def _empty_journal(session_id: str) -> dict[str, object]:
    return {
        "journal_schema": JOURNAL_SCHEMA,
        "session_id": session_id,
        "generation": 0,
        "last_committed_sequence": None,
        "segments": [],
    }


def _journal_segments(journal: Mapping[str, object]) -> list[dict[str, Any]]:
    segments = journal.get("segments")
    if not isinstance(segments, list) or not all(
        isinstance(item, dict) for item in segments
    ):
        raise ValueError("journal segments are invalid")
    return segments


def _validate_digest(value: object, name: str) -> str:
    if not is_sha256(value):
        raise ValueError(f"journal {name} is invalid")
    return str(value)


def _validate_journal(journal: object, session_id: str) -> dict[str, Any]:
    if not isinstance(journal, dict):
        raise ValueError("journal must be an object")
    require_exact_keys(journal, JOURNAL_KEYS, "journal")
    if (
        journal.get("journal_schema") != JOURNAL_SCHEMA
        or journal.get("session_id") != session_id
    ):
        raise ValueError("journal identity is invalid")
    generation = journal.get("generation")
    if (
        not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < 0
    ):
        raise ValueError("journal generation is invalid")
    segments = _journal_segments(journal)
    for segment in segments:
        require_exact_keys(segment, SEGMENT_KEYS, "journal segment")
        _validate_identifier(segment.get("segment_id"))
        _validate_digest(segment.get("dataset_id"), "dataset ID")
        _validate_digest(segment.get("schema_fingerprint"), "schema fingerprint")
        if segment.get("record_kind") != RECORD_KIND:
            raise ValueError("journal record kind is invalid")
        partitions = segment.get("partitions")
        if not isinstance(partitions, list):
            raise ValueError("journal partitions are invalid")
        for partition in partitions:
            _validate_partition_mapping(partition)
    _validate_journal_uniqueness(segments, journal.get("last_committed_sequence"))
    return journal


def _validate_journal_uniqueness(
    segments: list[dict[str, Any]], last_sequence: object
) -> None:
    segment_ids = [segment["segment_id"] for segment in segments]
    paths = [item["path"] for segment in segments for item in segment["partitions"]]
    ranges = [
        (item["sequence_start"], item["sequence_end"])
        for segment in segments
        for item in segment["partitions"]
    ]
    if len(segment_ids) != len(set(segment_ids)):
        raise ValueError("journal has duplicate segment IDs")
    if len(paths) != len(set(paths)):
        raise ValueError("journal has duplicate partition paths")
    ordered = sorted(ranges)
    if any(right[0] < left[1] for left, right in zip(ordered, ordered[1:])):
        raise ValueError("journal partition ranges overlap")
    expected_last = max((end for _, end in ranges), default=None)
    expected_last = None if expected_last is None else expected_last - 1
    if last_sequence != expected_last:
        raise ValueError("journal last committed sequence is inconsistent")


def _validate_partition_mapping(value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("journal partition is invalid")
    require_exact_keys(value, PARTITION_KEYS, "journal partition")
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


def _ranges_overlap(
    left: PendingPartition | PartitionRef, right: PendingPartition | PartitionRef
) -> bool:
    return (
        left.sequence_start < right.sequence_end
        and right.sequence_start < left.sequence_end
    )


class SessionStorage:
    """One session whose journal is the sole committed visibility boundary."""

    def __init__(
        self,
        root: Path,
        session: SessionRecord,
        identity: DatasetSemanticIdentity,
        generation: int,
    ) -> None:
        self._session = session
        self._identity = identity
        self._session_root = root / session.session_id
        self._expected_generation = generation
        self._lock = _session_lock(str(self._session_root))

    @property
    def session_root(self) -> Path:
        return self._session_root

    @classmethod
    def create(
        cls,
        root: Path,
        session: SessionRecord,
        identity: DatasetSemanticIdentity,
    ) -> SessionStorage:
        storage_root = require_storage_root(root)
        session_id = _validate_identifier(session.session_id)
        if type(identity) is not DatasetSemanticIdentity:
            raise TypeError("identity must be DatasetSemanticIdentity")
        if (identity.adapter_id, identity.adapter_version) != (
            session.adapter.id,
            session.adapter.version,
        ):
            raise ValueError("semantic identity adapter does not match the session")
        final = storage_root / session_id
        with _session_lock(f"root:{storage_root}"):
            if final.is_symlink():
                raise ValueError("session target cannot be a symlink")
            if final.exists():
                raise FileExistsError(f"session already exists: {session_id}")
            temporary = storage_root / f".{session_id}.{uuid.uuid4().hex}.pending"
            cls._create_tree(storage_root, temporary, final, session, identity)
        return cls(storage_root, session, identity, 0)

    @staticmethod
    def _create_tree(
        root: Path,
        temporary: Path,
        final: Path,
        session: SessionRecord,
        identity: DatasetSemanticIdentity,
    ) -> None:
        temporary.mkdir(mode=0o700)
        try:
            leaf_directories = [
                temporary / name for name in ("raw", "derived", "indexes", "quarantine")
            ]
            for directory in leaf_directories:
                directory.mkdir()
            normalized = temporary / "normalized"
            normalized.mkdir()
            syndromes = normalized / RECORD_KIND
            syndromes.mkdir()
            for directory in (*leaf_directories, normalized, syndromes):
                fsync_directory(directory)
            _write_json(
                temporary / "manifest.json", session_to_mapping(session), exclusive=True
            )
            _write_json(
                temporary / "identity.json", identity.to_mapping(), exclusive=True
            )
            _write_json(
                temporary / "journal.json",
                _empty_journal(session.session_id),
                exclusive=True,
            )
            fsync_directory(temporary)
            os.rename(temporary, final)
            fsync_directory(root)
        except Exception:
            if temporary.exists() and not temporary.is_symlink():
                shutil.rmtree(temporary)
            raise

    @classmethod
    def open(cls, root: Path, session_id: str) -> SessionStorage:
        storage_root = require_storage_root(root)
        identifier = _validate_identifier(session_id)
        session_root = storage_root / identifier
        if session_root.is_symlink() or not session_root.is_dir():
            raise ValueError("session directory is missing or unsafe")
        manifest_path = session_root / "manifest.json"
        if manifest_path.is_symlink():
            raise ValueError("session manifest cannot be a symlink")
        manifest = loads_canonical_json(manifest_path.read_text(encoding="utf-8"))
        session = session_from_mapping(manifest)
        if session.session_id != identifier:
            raise ValueError("session manifest identity does not match its directory")
        identity_path = safe_session_file(session_root, "identity.json")
        identity_value = loads_canonical_json(identity_path.read_text(encoding="utf-8"))
        identity = DatasetSemanticIdentity.from_mapping(identity_value)
        if (identity.adapter_id, identity.adapter_version) != (
            session.adapter.id,
            session.adapter.version,
        ):
            raise ValueError("semantic identity adapter does not match the session")
        storage = cls(storage_root, session, identity, 0)
        journal = storage._load_journal()
        storage._expected_generation = journal["generation"]
        return storage

    def _load_journal(self) -> dict[str, Any]:
        assert_session_root(self._session_root)
        path = safe_session_file(self._session_root, "journal.json")
        try:
            value = loads_canonical_json(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError("journal is malformed or unreadable") from error
        journal = _validate_journal(value, self._session.session_id)
        for segment in _journal_segments(journal):
            for partition in segment["partitions"]:
                safe_session_file(self._session_root, partition["path"])
        return journal

    def _semantic_dataset_id(
        self, batch: SyndromeBatch, profile: Mapping[str, object]
    ) -> str:
        parameters = {
            "segment_id": batch.segment_id,
            "session_kind": self._session.kind.value,
            "provenance": self._identity.to_mapping(),
            "schema": profile,
        }
        return dataset_id(
            schema_version=batch.schema_version,
            parent_dataset_ids=(),
            recipe_id="canonical-syndrome-import",
            recipe_version="1",
            parameters=parameters,
        )

    def append_batch(self, batch: SyndromeBatch) -> Path:
        if batch.session_id != self._session.session_id:
            raise ValueError("batch session does not match storage session")
        if batch.provenance_id != self._session.provenance_id:
            raise ValueError("batch provenance does not match storage session")
        segment_id = _validate_identifier(batch.segment_id)
        validate_batch_padding(batch)
        profile = packed_profile(batch)
        fingerprint = schema_fingerprint(profile)
        identity = self._semantic_dataset_id(batch, profile)
        with self._lock:
            journal = self._load_journal()
            self._check_append(journal, batch, fingerprint)
            directory = secure_directory(
                self._session_root,
                f"normalized/{RECORD_KIND}/{segment_id}",
                create=True,
            )
            fsync_directory(directory)
            fsync_directory(directory.parent)
            name = f"part-{batch.sequence_start:020d}-{batch.sequence_end - 1:020d}.parquet.pending"
            pending = directory / name
            write_pending(pending, batch, fingerprint, identity)
            return pending

    def _check_append(
        self, journal: Mapping[str, object], batch: SyndromeBatch, fingerprint: str
    ) -> None:
        committed = self._journal_refs(journal)
        candidate = PartitionRef(
            Path(), "", batch.record_count, batch.sequence_start, batch.sequence_end
        )
        if any(_ranges_overlap(candidate, ref) for ref in committed):
            raise ValueError("batch sequence range overlaps committed data")
        segments = [
            item
            for item in _journal_segments(journal)
            if item["segment_id"] == batch.segment_id
        ]
        if segments and segments[0]["schema_fingerprint"] != fingerprint:
            raise ValueError("schema transition requires a new segment")
        parent = secure_directory(self._session_root, f"normalized/{RECORD_KIND}")
        segment_path = parent / batch.segment_id
        paths = ()
        if segment_path.is_symlink():
            raise ValueError("storage directory is a symlink")
        if segment_path.exists():
            paths = walk_storage_files(
                self._session_root,
                f"normalized/{RECORD_KIND}/{batch.segment_id}",
                ".pending",
            )
        for path in paths:
            existing = inspect_partition(path)
            if existing.schema_fingerprint != fingerprint:
                raise ValueError("schema transition requires a new segment")
            if _ranges_overlap(candidate, existing):
                if (
                    existing.sequence_start == batch.sequence_start
                    and existing.sequence_end == batch.sequence_end
                ):
                    raise FileExistsError(
                        f"pending partition already exists: {path.name}"
                    )
                raise ValueError("batch sequence range overlaps pending data")

    def _journal_refs(self, journal: Mapping[str, object]) -> tuple[PartitionRef, ...]:
        refs: list[PartitionRef] = []
        for segment in _journal_segments(journal):
            for item in segment["partitions"]:
                refs.append(
                    PartitionRef(
                        safe_session_file(self._session_root, item["path"]),
                        item["sha256"],
                        item["rows"],
                        item["sequence_start"],
                        item["sequence_end"],
                    )
                )
        return tuple(
            sorted(refs, key=lambda ref: (ref.sequence_start, ref.sequence_end))
        )

    def list_committed_partitions(self) -> tuple[PartitionRef, ...]:
        with self._lock:
            return self._journal_refs(self._load_journal())

    def commit_segment(self, segment_id: str) -> tuple[PartitionRef, ...]:
        identifier = _validate_identifier(segment_id)
        with self._lock:
            journal = self._load_journal()
            if journal["generation"] != self._expected_generation:
                raise RuntimeError("journal generation changed; reopen the session")
            existing = self._segment_refs(journal, identifier)
            parent = secure_directory(self._session_root, f"normalized/{RECORD_KIND}")
            segment_path = parent / identifier
            if segment_path.is_symlink():
                raise ValueError("storage directory is a symlink")
            paths = (
                walk_storage_files(
                    self._session_root,
                    f"normalized/{RECORD_KIND}/{identifier}",
                    ".pending",
                )
                if segment_path.exists()
                else ()
            )
            pending = tuple(inspect_partition(path) for path in paths)
            if not pending:
                return existing
            self._validate_commit(journal, identifier, pending)
            final_refs = self._rename_pending(pending)
            next_journal = self._next_journal(journal, identifier, final_refs)
            self._replace_journal(next_journal)
            self._expected_generation = next_journal["generation"]
            return self._segment_refs(next_journal, identifier)

    def _segment_refs(
        self, journal: Mapping[str, object], segment_id: str
    ) -> tuple[PartitionRef, ...]:
        all_refs = self._journal_refs(journal)
        paths = {
            item["path"]
            for segment in _journal_segments(journal)
            if segment["segment_id"] == segment_id
            for item in segment["partitions"]
        }
        return tuple(
            ref
            for ref in all_refs
            if ref.path.relative_to(self._session_root).as_posix() in paths
        )

    def _validate_commit(
        self,
        journal: Mapping[str, object],
        segment_id: str,
        refs: tuple[PendingPartition, ...],
    ) -> None:
        if any(ref.segment_id != segment_id for ref in refs):
            raise ValueError("pending partition segment metadata is inconsistent")
        schemas = {(ref.schema_fingerprint, ref.dataset_id) for ref in refs}
        existing_segments = [
            item
            for item in _journal_segments(journal)
            if item["segment_id"] == segment_id
        ]
        if existing_segments:
            expected = (
                existing_segments[0]["schema_fingerprint"],
                existing_segments[0]["dataset_id"],
            )
            schemas.add(expected)
        if len(schemas) != 1:
            raise ValueError("schema transition requires a new segment")
        committed = self._journal_refs(journal)
        for index, ref in enumerate(refs):
            if any(_ranges_overlap(ref, item) for item in committed + refs[:index]):
                raise ValueError(
                    "pending partition sequence range overlaps existing data"
                )
            if self._final_path(ref).exists():
                raise FileExistsError("uncommitted final partition already exists")

    def _final_path(self, ref: PendingPartition) -> Path:
        relative = ref.path.relative_to(self._session_root)
        source = safe_session_file(self._session_root, relative.as_posix())
        if source != ref.path:
            raise ValueError("pending partition path identity changed")
        final = relative.with_suffix("")
        return safe_session_file(self._session_root, final.as_posix())

    def _rename_pending(
        self, refs: tuple[PendingPartition, ...]
    ) -> tuple[PendingPartition, ...]:
        renamed: list[PendingPartition] = []
        for ref in refs:
            final = self._final_path(ref)
            os.rename(ref.path, final)
            renamed.append(
                PendingPartition(
                    final.relative_to(self._session_root),
                    ref.sha256,
                    ref.rows,
                    ref.sequence_start,
                    ref.sequence_end,
                    ref.segment_id,
                    ref.dataset_id,
                    ref.schema_fingerprint,
                    True,
                )
            )
        fsync_directory(refs[0].path.parent)
        return tuple(renamed)

    def _next_journal(
        self,
        journal: Mapping[str, object],
        segment_id: str,
        refs: tuple[PendingPartition, ...],
    ) -> dict[str, object]:
        other = [
            item
            for item in _journal_segments(journal)
            if item["segment_id"] != segment_id
        ]
        current = [
            item
            for item in _journal_segments(journal)
            if item["segment_id"] == segment_id
        ]
        prior_refs = self._relative_pending_refs(current)
        segment = _segment_mapping(
            tuple(sorted(prior_refs + refs, key=lambda item: item.sequence_start))
        )
        segments = sorted(other + [segment], key=lambda item: item["segment_id"])
        ends = [
            item["sequence_end"]
            for journal_segment in segments
            for item in journal_segment["partitions"]
        ]
        return {
            "journal_schema": JOURNAL_SCHEMA,
            "session_id": self._session.session_id,
            "generation": journal["generation"] + 1,
            "last_committed_sequence": max(ends) - 1,
            "segments": segments,
        }

    def _relative_pending_refs(
        self, segments: list[dict[str, Any]]
    ) -> tuple[PendingPartition, ...]:
        refs: list[PendingPartition] = []
        for segment in segments:
            for item in segment["partitions"]:
                refs.append(
                    PendingPartition(
                        Path(item["path"]),
                        item["sha256"],
                        item["rows"],
                        item["sequence_start"],
                        item["sequence_end"],
                        segment["segment_id"],
                        segment["dataset_id"],
                        segment["schema_fingerprint"],
                        True,
                    )
                )
        return tuple(refs)

    def _replace_journal(self, journal: Mapping[str, object]) -> None:
        assert_session_root(self._session_root)
        temporary = safe_session_file(
            self._session_root, f".journal.{uuid.uuid4().hex}.tmp"
        )
        journal_path = safe_session_file(self._session_root, "journal.json")
        _write_json(temporary, journal, exclusive=True)
        os.replace(temporary, journal_path)
        fsync_directory(self._session_root)

    def recover(self) -> RecoveryReport:
        with self._lock:
            try:
                journal = self._load_journal()
            except (ValueError, OSError) as error:
                return RecoveryReport(fatal_error=str(error))
            missing, corrupt = verify_committed(self._session_root, journal)
            scan = scan_uncommitted(
                self._session_root,
                journal["generation"],
                committed_refs(self._session_root, journal),
            )
            invalid_temps = self._remove_journal_temps()
            fatal = (
                "committed storage integrity failure" if missing or corrupt else None
            )
            return RecoveryReport(
                resumable=scan.resumable,
                invalid_deleted=scan.invalid_deleted + invalid_temps,
                orphaned_final=scan.orphaned_final,
                missing_committed=missing,
                corrupt_committed=corrupt,
                duplicates=scan.duplicates,
                quarantined=scan.quarantined,
                sequence_gaps=_sequence_gaps(self._journal_refs(journal)),
                fatal_error=fatal,
            )

    def _remove_journal_temps(self) -> tuple[RecoveryIssue, ...]:
        issues: list[RecoveryIssue] = []
        assert_session_root(self._session_root)
        for path in sorted(self._session_root.glob(".journal.*.tmp")):
            if path.is_symlink():
                issues.append(
                    RecoveryIssue(path, "unsafe journal temp symlink retained")
                )
                continue
            path.unlink(missing_ok=True)
            issues.append(RecoveryIssue(path, "incomplete journal temp deleted"))
        return tuple(issues)

    def resume_pending(self, refs: Iterable[PendingPartition]) -> tuple[Path, ...]:
        resumed: list[Path] = []
        with self._lock:
            requested, duplicates = self._authorize_recovery(refs)
            for ref in requested:
                path = self._require_recovery_ref(ref)
                if ref in duplicates:
                    path.unlink()
                    fsync_directory(path.parent)
                    continue
                if ref.is_final:
                    pending = path.with_suffix(path.suffix + ".pending")
                    if pending.exists():
                        raise FileExistsError("pending recovery target already exists")
                    os.rename(path, pending)
                    path = pending
                resumed.append(path)
            for directory in {path.parent for path in resumed}:
                fsync_directory(directory)
        return tuple(resumed)

    def discard_pending(self, refs: Iterable[PendingPartition]) -> None:
        with self._lock:
            requested, _ = self._authorize_recovery(refs)
            paths = tuple(self._require_recovery_ref(ref) for ref in requested)
            for path in paths:
                path.unlink(missing_ok=True)
            for directory in {path.parent for path in paths}:
                fsync_directory(directory)

    def _authorize_recovery(
        self, refs: Iterable[PendingPartition]
    ) -> tuple[tuple[PendingPartition, ...], frozenset[PendingPartition]]:
        requested = tuple(refs)
        if len(requested) != len(set(requested)):
            raise ValueError("recovery references must be unique")
        report = self.recover()
        if report.fatal_error is not None:
            raise ValueError(f"recovery is not authorized: {report.fatal_error}")
        allowed = frozenset(
            report.resumable + report.orphaned_final + report.duplicates
        )
        if any(ref not in allowed for ref in requested):
            raise ValueError("recovery reference is not authorized by fresh recovery")
        journal = self._load_journal()
        committed = {ref.path for ref in committed_refs(self._session_root, journal)}
        if any(ref.path in committed for ref in requested):
            raise ValueError("committed partitions are not authorized for recovery")
        return requested, frozenset(report.duplicates)

    def _require_recovery_ref(self, ref: PendingPartition) -> Path:
        try:
            relative = ref.path.relative_to(self._session_root)
        except ValueError as error:
            raise ValueError("recovery reference escapes the session root") from error
        path = safe_session_file(self._session_root, relative.as_posix())
        actual = inspect_partition(path, is_final=ref.is_final)
        if replace(actual, journal_generation=ref.journal_generation) != ref:
            raise ValueError("recovery reference identity changed")
        return path

    def verify(self) -> VerificationReport:
        with self._lock:
            try:
                journal = self._load_journal()
                missing, corrupt = verify_committed(self._session_root, journal)
            except (ValueError, OSError) as error:
                return VerificationReport(False, fatal_error=str(error))
            fatal = (
                "committed storage integrity failure" if missing or corrupt else None
            )
            return VerificationReport(
                not missing and not corrupt, missing, corrupt, fatal
            )


def _sequence_gaps(refs: tuple[PartitionRef, ...]) -> tuple[SequenceGap, ...]:
    gaps: list[SequenceGap] = []
    cursor: int | None = None
    for ref in refs:
        if cursor is not None and ref.sequence_start > cursor:
            gaps.append(SequenceGap(cursor, ref.sequence_start))
        cursor = ref.sequence_end if cursor is None else max(cursor, ref.sequence_end)
    return tuple(gaps)
