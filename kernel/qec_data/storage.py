"""Crash-safe Parquet storage for canonical typed QEC sessions."""

from __future__ import annotations

import json
import shutil
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .adapters.base import ImportChunk, SourceSpan
from .hashing import (
    DatasetSemanticIdentity,
    dataset_id,
)
from .model_codecs import loads_canonical_json, session_from_mapping, session_to_mapping
from .models import CalibrationBatch, CampaignPointBatch, SessionRecord, SyndromeBatch
from .storage_durability import DurableMover
from .storage_locking import session_lock as _session_lock
from .storage_metadata import publish_json
from .storage_parquet import (
    RECORD_KIND,
    PendingPartition,
    inspect_partition,
    packed_profile,
    schema_fingerprint,
    validate_batch_padding,
    write_pending,
)
from .storage_lineage import (
    SegmentKey,
    payload_kind,
    source_spans_from_value,
)
from .storage_journal import (
    JOURNAL_SCHEMA,
    empty_journal as _empty_journal,
    journal_segments as _journal_segments,
    ranges_overlap as _ranges_overlap,
    segment_mapping as _segment_mapping,
    validate_identifier as _validate_identifier,
    validate_journal as _validate_journal,
)
from .storage_typed_parquet import typed_profile, typed_schema_fingerprint
from .storage_paths import (
    assert_session_root,
    require_storage_root,
    safe_session_file,
    secure_directory,
    walk_storage_files,
)
from .storage_recovery import (
    QuarantinedPartition,
    RecoveryIssue,
    committed_refs,
    scan_uncommitted,
    verify_committed,
)


@dataclass(frozen=True, slots=True)
class PartitionRef:
    path: Path
    sha256: str
    rows: int
    sequence_start: int
    sequence_end: int
    record_kind: str = RECORD_KIND
    segment_id: str = ""
    source_spans: tuple[SourceSpan, ...] = ()


@dataclass(frozen=True, slots=True)
class SequenceGap:
    start: int
    end: int
    record_kind: str = RECORD_KIND


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


class SessionStorage:
    """One session whose journal is the sole committed visibility boundary."""

    def __init__(
        self,
        root: Path,
        session: SessionRecord,
        identity: DatasetSemanticIdentity,
        generation: int,
        mover: DurableMover,
    ) -> None:
        self._session = session
        self._identity = identity
        self._session_root = root / session.session_id
        self._expected_generation = generation
        self._mover = mover
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
        *,
        mover: DurableMover | None = None,
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
        durable_mover = mover or DurableMover()
        with _session_lock(f"root:{storage_root}"):
            if final.is_symlink():
                raise ValueError("session target cannot be a symlink")
            if final.exists():
                raise FileExistsError(f"session already exists: {session_id}")
            temporary = storage_root / f".{session_id}.{uuid.uuid4().hex}.pending"
            cls._create_tree(
                temporary,
                final,
                session,
                identity,
                durable_mover,
            )
        return cls(storage_root, session, identity, 0, durable_mover)

    @staticmethod
    def _create_tree(
        temporary: Path,
        final: Path,
        session: SessionRecord,
        identity: DatasetSemanticIdentity,
        mover: DurableMover,
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
            kind_directories = tuple(
                normalized / kind
                for kind in ("syndromes", "campaign_points", "calibrations")
            )
            for directory in kind_directories:
                directory.mkdir()
            for directory in (*leaf_directories, normalized, *kind_directories):
                mover.sync_directory(directory)
            publish_json(
                temporary / "manifest.json",
                session_to_mapping(session),
                mover,
                replace_existing=False,
            )
            publish_json(
                temporary / "identity.json",
                identity.to_mapping(),
                mover,
                replace_existing=False,
            )
            publish_json(
                temporary / "journal.json",
                _empty_journal(session.session_id),
                mover,
                replace_existing=False,
            )
            mover.sync_directory(temporary)
            mover.move(temporary, final)
        except Exception:
            if temporary.exists() and not temporary.is_symlink():
                shutil.rmtree(temporary)
            raise

    @classmethod
    def open(
        cls,
        root: Path,
        session_id: str,
        *,
        mover: DurableMover | None = None,
    ) -> SessionStorage:
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
        storage = cls(storage_root, session, identity, 0, mover or DurableMover())
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
        self,
        batch: SyndromeBatch | CampaignPointBatch | CalibrationBatch,
        profile: Mapping[str, object],
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
            recipe_id={
                "syndromes": "canonical-syndrome-import",
                "campaign_points": "canonical-campaign-points-import",
                "calibrations": "canonical-calibration-import",
            }[payload_kind(batch)],
            recipe_version="1",
            parameters=parameters,
        )

    def append_batch(self, batch: SyndromeBatch) -> Path:
        if type(batch) is not SyndromeBatch:
            raise TypeError("append_batch accepts SyndromeBatch only")
        return self._append_payload(batch, ())

    def append_chunk(self, chunk: ImportChunk) -> Path:
        if type(chunk) is not ImportChunk:
            raise TypeError("chunk must be ImportChunk")
        return self._append_payload(chunk.payload, chunk.source_spans)

    def _append_payload(
        self,
        batch: SyndromeBatch | CampaignPointBatch | CalibrationBatch,
        source_spans: tuple[SourceSpan, ...],
    ) -> Path:
        if batch.session_id != self._session.session_id:
            raise ValueError("batch session does not match storage session")
        if batch.provenance_id != self._session.provenance_id:
            raise ValueError("batch provenance does not match storage session")
        segment_id = _validate_identifier(batch.segment_id)
        kind = payload_kind(batch)
        if type(batch) is SyndromeBatch:
            validate_batch_padding(batch)
            profile: Mapping[str, object] = packed_profile(batch)
            fingerprint = schema_fingerprint(dict(profile))
        else:
            profile = {"record_kind": kind, "profile": typed_profile(kind)}
            fingerprint = typed_schema_fingerprint(kind)
        identity = self._semantic_dataset_id(batch, profile)
        with self._lock:
            journal = self._load_journal()
            self._check_append(journal, batch, fingerprint, kind)
            directory = secure_directory(
                self._session_root,
                f"normalized/{kind}/{segment_id}",
                create=True,
            )
            self._mover.sync_directory(directory)
            self._mover.sync_directory(directory.parent)
            name = f"part-{batch.sequence_start:020d}-{batch.sequence_end - 1:020d}.parquet.pending"
            pending = directory / name
            write_pending(
                pending,
                batch,
                fingerprint,
                identity,
                self._mover,
                source_spans,
            )
            return pending

    def _check_append(
        self,
        journal: Mapping[str, object],
        batch: SyndromeBatch | CampaignPointBatch | CalibrationBatch,
        fingerprint: str,
        record_kind: str,
    ) -> None:
        committed = self._journal_refs(journal)
        candidate = PartitionRef(
            Path(),
            "",
            batch.record_count,
            batch.sequence_start,
            batch.sequence_end,
            record_kind,
            batch.segment_id,
        )
        if any(_ranges_overlap(candidate, ref) for ref in committed):
            raise ValueError("batch sequence range overlaps committed data")
        segments = [
            item
            for item in _journal_segments(journal)
            if item["segment_id"] == batch.segment_id
            and item["record_kind"] == record_kind
        ]
        if segments and segments[0]["schema_fingerprint"] != fingerprint:
            raise ValueError("schema transition requires a new segment")
        for path in self._pending_paths(record_kind, batch.segment_id):
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

    def _pending_paths(self, record_kind: str, segment_id: str) -> tuple[Path, ...]:
        parent = secure_directory(
            self._session_root, f"normalized/{record_kind}", create=True
        )
        segment_path = parent / segment_id
        if segment_path.is_symlink():
            raise ValueError("storage directory is a symlink")
        if not segment_path.exists():
            return ()
        return walk_storage_files(
            self._session_root,
            f"normalized/{record_kind}/{segment_id}",
            ".pending",
        )

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
                        segment["record_kind"],
                        segment["segment_id"],
                        source_spans_from_value(item.get("source_spans", [])),
                    )
                )
        return tuple(
            sorted(
                refs,
                key=lambda ref: (
                    ref.record_kind,
                    ref.sequence_start,
                    ref.sequence_end,
                ),
            )
        )

    def list_committed_partitions(self) -> tuple[PartitionRef, ...]:
        with self._lock:
            return self._journal_refs(self._load_journal())

    def commit_segment(
        self, segment_id: str, *, record_kind: str = RECORD_KIND
    ) -> tuple[PartitionRef, ...]:
        key = SegmentKey(record_kind, _validate_identifier(segment_id))
        self.commit_segments((key,))
        with self._lock:
            return self._segment_refs(self._load_journal(), key)

    def commit_segments(self, keys: Iterable[SegmentKey]) -> tuple[PartitionRef, ...]:
        requested = tuple(keys)
        if not requested or any(type(key) is not SegmentKey for key in requested):
            raise ValueError("commit segment keys must be a nonempty SegmentKey tuple")
        if len(requested) != len(set(requested)):
            raise ValueError("commit segment keys must be unique")
        with self._lock:
            journal = self._load_journal()
            if journal["generation"] != self._expected_generation:
                raise RuntimeError("journal generation changed; reopen the session")
            groups = tuple((key, self._pending_for_key(key)) for key in requested)
            changed = tuple((key, refs) for key, refs in groups if refs)
            if not changed:
                return tuple(
                    ref for key in requested for ref in self._segment_refs(journal, key)
                )
            validating: tuple[PendingPartition, ...] = ()
            for key, refs in changed:
                self._validate_commit(journal, key, refs, validating)
                validating += refs
            renamed = tuple((key, self._rename_pending(refs)) for key, refs in changed)
            next_journal = self._next_journal(journal, renamed)
            self._replace_journal(next_journal)
            self._expected_generation = next_journal["generation"]
            return tuple(
                ref
                for key in requested
                for ref in self._segment_refs(next_journal, key)
            )

    def _pending_for_key(self, key: SegmentKey) -> tuple[PendingPartition, ...]:
        parent = secure_directory(
            self._session_root, f"normalized/{key.record_kind}", create=True
        )
        segment_path = parent / key.segment_id
        if segment_path.is_symlink():
            raise ValueError("storage directory is a symlink")
        if not segment_path.exists():
            return ()
        paths = walk_storage_files(
            self._session_root,
            f"normalized/{key.record_kind}/{key.segment_id}",
            ".pending",
        )
        return tuple(inspect_partition(path) for path in paths)

    def _segment_refs(
        self, journal: Mapping[str, object], key: SegmentKey
    ) -> tuple[PartitionRef, ...]:
        all_refs = self._journal_refs(journal)
        paths = {
            item["path"]
            for segment in _journal_segments(journal)
            if segment["segment_id"] == key.segment_id
            and segment["record_kind"] == key.record_kind
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
        key: SegmentKey,
        refs: tuple[PendingPartition, ...],
        additional: tuple[PendingPartition, ...] = (),
    ) -> None:
        if any(
            (ref.record_kind, ref.segment_id) != (key.record_kind, key.segment_id)
            for ref in refs
        ):
            raise ValueError("pending partition segment metadata is inconsistent")
        schemas = {(ref.schema_fingerprint, ref.dataset_id) for ref in refs}
        existing_segments = [
            item
            for item in _journal_segments(journal)
            if item["segment_id"] == key.segment_id
            and item["record_kind"] == key.record_kind
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
            if any(
                _ranges_overlap(ref, item)
                for item in committed + additional + refs[:index]
            ):
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
            self._mover.move(ref.path, final)
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
                    record_kind=ref.record_kind,
                    source_spans=ref.source_spans,
                )
            )
        return tuple(renamed)

    def _next_journal(
        self,
        journal: Mapping[str, object],
        groups: tuple[tuple[SegmentKey, tuple[PendingPartition, ...]], ...],
    ) -> dict[str, object]:
        keys = frozenset(key for key, _ in groups)
        other = [
            item
            for item in _journal_segments(journal)
            if SegmentKey(item["record_kind"], item["segment_id"]) not in keys
        ]
        changed = [self._updated_segment(journal, key, refs) for key, refs in groups]
        segments = sorted(
            other + changed,
            key=lambda item: (item["record_kind"], item["segment_id"]),
        )
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

    def _updated_segment(
        self,
        journal: Mapping[str, object],
        key: SegmentKey,
        refs: tuple[PendingPartition, ...],
    ) -> dict[str, object]:
        current = [
            item
            for item in _journal_segments(journal)
            if item["segment_id"] == key.segment_id
            and item["record_kind"] == key.record_kind
        ]
        prior = self._relative_pending_refs(current)
        return _segment_mapping(
            tuple(sorted(prior + refs, key=lambda item: item.sequence_start))
        )

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
                        record_kind=segment["record_kind"],
                        source_spans=source_spans_from_value(
                            item.get("source_spans", [])
                        ),
                    )
                )
        return tuple(refs)

    def _replace_journal(self, journal: Mapping[str, object]) -> None:
        assert_session_root(self._session_root)
        journal_path = safe_session_file(self._session_root, "journal.json")
        publish_json(
            journal_path,
            journal,
            self._mover,
            replace_existing=True,
        )

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
                self._mover,
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
            self._mover.sync_directory(path.parent)
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
                    self._mover.sync_directory(path.parent)
                    continue
                if ref.is_final:
                    pending = path.with_suffix(path.suffix + ".pending")
                    if pending.exists():
                        raise FileExistsError("pending recovery target already exists")
                    self._mover.move(path, pending)
                    path = pending
                resumed.append(path)
        return tuple(resumed)

    def discard_pending(self, refs: Iterable[PendingPartition]) -> None:
        with self._lock:
            requested, _ = self._authorize_recovery(refs)
            paths = tuple(self._require_recovery_ref(ref) for ref in requested)
            for path in paths:
                path.unlink(missing_ok=True)
            for directory in {path.parent for path in paths}:
                self._mover.sync_directory(directory)

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
    for kind in sorted({ref.record_kind for ref in refs}):
        cursor: int | None = None
        typed = sorted(
            (ref for ref in refs if ref.record_kind == kind),
            key=lambda ref: ref.sequence_start,
        )
        for ref in typed:
            if cursor is not None and ref.sequence_start > cursor:
                gaps.append(SequenceGap(cursor, ref.sequence_start, kind))
            cursor = (
                ref.sequence_end if cursor is None else max(cursor, ref.sequence_end)
            )
    return tuple(gaps)
