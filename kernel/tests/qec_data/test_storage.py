from __future__ import annotations

import json
import os
import shutil
import threading
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

import kernel.qec_data.storage_parquet as parquet_storage
from kernel.qec_data.hashing import (
    DatasetSemanticIdentity,
    canonical_json_bytes,
    dataset_id,
)
from kernel.qec_data.models import (
    IndexRange,
    PackedBits,
    QualifiedPackedBits,
    QualifiedRange,
    QualifiedTimestamps,
    SessionKind,
    SessionRecord,
    SyndromeBatch,
    TimestampSeries,
    ValueStatus,
)
from kernel.qec_data.storage import (
    PartitionRef,
    PendingPartition,
    SessionStorage,
    _session_lock,
)


def sample_session(session_id: str = "session-1") -> SessionRecord:
    return SessionRecord.minimal(
        session_id,
        SessionKind.HARDWARE_IMPORT,
        "generic.binary",
        "1.0.0",
        "provenance-1",
    )


def sample_identity(source_sha256: str = "a" * 64) -> DatasetSemanticIdentity:
    return DatasetSemanticIdentity(
        source_sha256=(source_sha256,),
        adapter_id="generic.binary",
        adapter_version="1.0.0",
        mapping=(("detectors", "detector_events"),),
        bit_widths=(("detectors", 9),),
        units=(("timestamp", "ns"),),
        time_domain="timestamp",
    )


def create_storage(root: Path, session_id: str = "session-1") -> SessionStorage:
    return SessionStorage.create(root, sample_session(session_id), sample_identity())


def sample_batch(
    *,
    start: int = 0,
    count: int = 3,
    segment_id: str = "segment-0001",
    detector_width: int = 9,
    detector_data: bytes | None = None,
    observables: QualifiedPackedBits | None = None,
    session_id: str = "session-1",
) -> SyndromeBatch:
    detector_bytes = (detector_width + 7) // 8
    return SyndromeBatch(
        batch_id=f"batch-{start}",
        session_id=session_id,
        segment_id=segment_id,
        sequence_start=start,
        sequence_end=start + count,
        record_count=count,
        detector_events=PackedBits(
            detector_width,
            detector_data or bytes(detector_bytes * count),
        ),
        observables=observables or QualifiedPackedBits(None, ValueStatus.ABSENT),
        provenance_id="provenance-1",
    )


def session_dir(root: Path) -> Path:
    return root / "session-1"


def test_uncommitted_partition_is_not_visible(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    pending = storage.append_batch(sample_batch())

    assert pending.suffix == ".pending"
    assert storage.list_committed_partitions() == ()

    committed = storage.commit_segment("segment-0001")
    assert len(committed) == 1
    assert storage.list_committed_partitions() == committed
    assert committed[0].path.suffix == ".parquet"


def test_create_is_atomic_and_exclusive(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)

    assert storage.session_root == session_dir(tmp_path)
    assert (
        json.loads((storage.session_root / "manifest.json").read_text())["session_id"]
        == "session-1"
    )
    assert (
        json.loads((storage.session_root / "journal.json").read_text())["generation"]
        == 0
    )
    assert not tuple(tmp_path.glob(".session-1.*.pending"))
    with pytest.raises(FileExistsError):
        SessionStorage.create(tmp_path, sample_session(), sample_identity())


@pytest.mark.parametrize("identifier", ["../escape", "/absolute", ".", "a/b", "a\\b"])
def test_session_and_segment_identifiers_cannot_escape_root(
    tmp_path: Path, identifier: str
) -> None:
    with pytest.raises(ValueError, match="identifier"):
        SessionStorage.create(tmp_path, sample_session(identifier), sample_identity())

    storage = create_storage(tmp_path, "valid")
    with pytest.raises(ValueError, match="identifier"):
        storage.append_batch(sample_batch(session_id="valid", segment_id=identifier))


def test_create_rejects_symlink_session_target(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (tmp_path / "session-1").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="symlink"):
        SessionStorage.create(tmp_path, sample_session(), sample_identity())


def test_open_rejects_manifest_identity_substitution(tmp_path: Path) -> None:
    first = create_storage(tmp_path, "session-1")
    second = create_storage(tmp_path, "session-2")
    (first.session_root / "manifest.json").write_bytes(
        (second.session_root / "manifest.json").read_bytes()
    )

    with pytest.raises(ValueError, match="identity"):
        SessionStorage.open(tmp_path, "session-1")


def test_parquet_uses_fixed_binary_buffers_without_optional_zero_width_columns(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    pending = storage.append_batch(sample_batch())
    table = pq.read_table(pending)

    assert table.schema.field("detectors").type == pa.binary(2)
    assert table.column("detectors").to_pylist() == [b"\0\0"] * 3
    assert "observables" not in table.column_names
    assert "measurements" not in table.column_names
    assert table.column("sequence").to_pylist() == [0, 1, 2]


def test_nonzero_padding_bits_are_rejected(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    invalid = object.__new__(PackedBits)
    object.__setattr__(invalid, "bit_width", 9)
    object.__setattr__(invalid, "data", b"\x00\x02")
    bad = replace(sample_batch(count=1), detector_events=invalid)

    with pytest.raises(ValueError, match="padding"):
        storage.append_batch(bad)
    assert not tuple(storage.session_root.rglob("*.pending"))


def test_optional_fixed_width_columns_and_ranges_are_materialized(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    batch = replace(
        sample_batch(),
        observables=QualifiedPackedBits(PackedBits(1, b"\0\1\0"), ValueStatus.MEASURED),
        round_range=QualifiedRange(IndexRange(8, 11), ValueStatus.MEASURED),
        source_timestamps=QualifiedTimestamps(
            TimestampSeries((100.0, 101.0, 102.0), "ns"),
            ValueStatus.MEASURED,
        ),
    )
    table = pq.read_table(storage.append_batch(batch))

    assert table.schema.field("observables").type == pa.binary(1)
    assert table.column("round").to_pylist() == [8, 9, 10]
    assert table.column("timestamp_ns").to_pylist() == [100, 101, 102]


def test_storage_rejects_timestamp_outside_signed_int64_before_arrow_write(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    batch = replace(
        sample_batch(count=1),
        source_timestamps=QualifiedTimestamps(
            TimestampSeries((2**63,), "ns"), ValueStatus.MEASURED
        ),
    )

    with pytest.raises(ValueError, match="signed 64-bit"):
        storage.append_batch(batch)


def test_storage_rejects_round_outside_uint32_before_arrow_write(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    batch = replace(
        sample_batch(count=1),
        round_range=QualifiedRange(IndexRange(2**32, 2**32 + 1), ValueStatus.MEASURED),
    )

    with pytest.raises(ValueError, match="round values must fit unsigned 32-bit"):
        storage.append_batch(batch)


def test_pending_create_is_exclusive_and_schema_change_requires_new_segment(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    with pytest.raises(FileExistsError):
        storage.append_batch(sample_batch())
    with pytest.raises(ValueError, match="new segment"):
        storage.append_batch(sample_batch(start=3, detector_width=8))

    changed = storage.append_batch(
        sample_batch(start=3, segment_id="segment-0002", detector_width=8)
    )
    assert changed.exists()


def test_commit_verifies_footer_schema_hash_and_sequence_range(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    pending = storage.append_batch(sample_batch())
    pending.write_bytes(b"not parquet")

    with pytest.raises(ValueError, match="Parquet"):
        storage.commit_segment("segment-0001")
    assert storage.list_committed_partitions() == ()


def test_commit_rejects_wrong_parquet_record_kind(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    pending = storage.append_batch(sample_batch())
    table = pq.read_table(pending)
    metadata = dict(table.schema.metadata or {})
    metadata[b"qec.record_kind"] = b"calibration"
    pending.unlink()
    pq.write_table(table.replace_schema_metadata(metadata), pending)

    with pytest.raises(ValueError, match="record kind"):
        storage.commit_segment("segment-0001")


def test_append_rejects_batches_above_canonical_partition_limit(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    oversized = sample_batch(count=65_537, detector_width=1)

    with pytest.raises(ValueError, match="65,536"):
        storage.append_batch(oversized)


def test_commit_rejects_overlap_and_repeated_commit_is_idempotent(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch(start=0))
    first = storage.commit_segment("segment-0001")
    assert storage.commit_segment("segment-0001") == first

    with pytest.raises(ValueError, match="overlap"):
        storage.append_batch(sample_batch(start=2, segment_id="segment-0002"))


def test_gap_is_preserved_and_reported(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch(start=0))
    storage.commit_segment("segment-0001")
    storage.append_batch(sample_batch(start=5))
    storage.commit_segment("segment-0001")

    report = storage.recover()
    assert [(gap.start, gap.end) for gap in report.sequence_gaps] == [(3, 5)]


def test_journal_last_sequence_spans_all_segments(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch(start=10, segment_id="segment-a"))
    storage.commit_segment("segment-a")
    storage.append_batch(sample_batch(start=0, segment_id="segment-z"))
    storage.commit_segment("segment-z")

    journal = json.loads((storage.session_root / "journal.json").read_text())
    assert journal["last_committed_sequence"] == 12


def test_journal_is_visibility_boundary_after_interrupted_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    real_replace = os.replace

    def interrupt_journal(source: str | Path, target: str | Path) -> None:
        if Path(target).name == "journal.json":
            raise OSError("simulated power loss")
        real_replace(source, target)

    monkeypatch.setattr(os, "replace", interrupt_journal)
    with pytest.raises(OSError, match="power loss"):
        storage.commit_segment("segment-0001")

    assert storage.list_committed_partitions() == ()
    report = storage.recover()
    assert len(report.orphaned_final) == 1
    assert report.resumable == ()


def test_recovery_never_promotes_and_resume_is_explicit(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    pending = storage.append_batch(sample_batch())

    report = storage.recover()
    assert [item.path for item in report.resumable] == [pending]
    assert storage.list_committed_partitions() == ()

    resumed = storage.resume_pending(report.resumable)
    assert resumed == (pending,)
    assert storage.list_committed_partitions() == ()
    assert len(storage.commit_segment("segment-0001")) == 1


def test_orphaned_final_requires_explicit_resume(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    pending = storage.append_batch(sample_batch())
    final = pending.with_suffix("")
    pending.rename(final)

    report = storage.recover()
    assert [item.path for item in report.orphaned_final] == [final]
    assert storage.list_committed_partitions() == ()
    resumed = storage.resume_pending(report.orphaned_final)
    assert resumed[0].suffix == ".pending"
    assert len(storage.commit_segment("segment-0001")) == 1


def test_recovery_deletes_corrupt_pending_but_valid_content_is_read_only(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    valid = storage.append_batch(sample_batch())
    corrupt = valid.with_name(
        "part-00000000000000000003-00000000000000000003.parquet.pending"
    )
    corrupt.write_bytes(b"")

    report = storage.recover()
    assert valid.exists()
    assert not corrupt.exists()
    assert len(report.invalid_deleted) == 1
    storage.discard_pending(report.resumable)
    assert not valid.exists()


def test_recovery_fails_closed_for_missing_or_corrupt_committed_files(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    committed = storage.commit_segment("segment-0001")[0]
    committed.path.write_bytes(b"tampered")

    corrupt = storage.verify()
    assert corrupt.ok is False
    assert len(corrupt.corrupt_committed) == 1
    recovery = storage.recover()
    assert len(recovery.corrupt_committed) == 1
    assert recovery.fatal_error is not None

    committed.path.unlink()
    missing = storage.recover()
    assert len(missing.missing_committed) == 1


def test_malformed_or_traversing_journal_fails_closed(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    journal = storage.session_root / "journal.json"
    journal.write_text("{", encoding="utf-8")
    report = storage.recover()
    assert report.fatal_error is not None
    with pytest.raises(ValueError, match="journal"):
        storage.list_committed_partitions()

    journal.write_text(
        json.dumps(
            {
                "journal_schema": "qec-storage-journal/1",
                "session_id": "session-1",
                "generation": 1,
                "last_committed_sequence": 0,
                "segments": [
                    {
                        "segment_id": "segment-0001",
                        "dataset_id": "a" * 64,
                        "record_kind": "syndromes",
                        "schema_fingerprint": "b" * 64,
                        "partitions": [
                            {
                                "path": "../outside.parquet",
                                "sha256": "c" * 64,
                                "rows": 1,
                                "sequence_start": 0,
                                "sequence_end": 1,
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    assert storage.recover().fatal_error is not None


def test_journal_rejects_duplicate_paths_overlaps_and_segment_ids(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    storage.commit_segment("segment-0001")
    journal_path = storage.session_root / "journal.json"
    original = json.loads(journal_path.read_text())

    duplicated_partition = json.loads(json.dumps(original))
    duplicated_partition["segments"][0]["partitions"].append(
        dict(duplicated_partition["segments"][0]["partitions"][0])
    )
    journal_path.write_text(json.dumps(duplicated_partition))
    assert storage.recover().fatal_error is not None

    duplicated_segment = json.loads(json.dumps(original))
    duplicated_segment["segments"].append(dict(duplicated_segment["segments"][0]))
    journal_path.write_text(json.dumps(duplicated_segment))
    assert storage.recover().fatal_error is not None


def test_verify_compares_journal_segment_metadata_to_parquet(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    storage.commit_segment("segment-0001")
    journal_path = storage.session_root / "journal.json"
    journal = json.loads(journal_path.read_text())
    journal["segments"][0]["schema_fingerprint"] = "f" * 64
    journal_path.write_text(json.dumps(journal))

    report = storage.verify()
    assert report.ok is False
    assert len(report.corrupt_committed) == 1


def test_symlinked_committed_partition_is_rejected(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    partition = storage.commit_segment("segment-0001")[0]
    outside = tmp_path / "outside.parquet"
    outside.write_bytes(partition.path.read_bytes())
    partition.path.unlink()
    partition.path.symlink_to(outside)

    report = storage.recover()
    assert report.fatal_error is not None


def test_partition_and_report_records_are_immutable(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    partition = storage.commit_segment("segment-0001")[0]
    with pytest.raises(FrozenInstanceError):
        partition.rows = 10  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        storage.recover().fatal_error = "changed"  # type: ignore[misc]
    assert isinstance(partition, PartitionRef)


def test_dataset_id_is_semantic_canonical_and_rejects_non_finite_numbers() -> None:
    composed = dataset_id(
        schema_version="1.0.0",
        parent_dataset_ids=("b" * 64, "a" * 64),
        recipe_id="import",
        recipe_version="1",
        parameters={"label": "Cafe\u0301", "rate": 1.0, "enabled": True},
    )
    precomposed = dataset_id(
        schema_version="1.0.0",
        parent_dataset_ids=("a" * 64, "b" * 64),
        recipe_id="import",
        recipe_version="1",
        parameters={"enabled": True, "rate": 1, "label": "Caf\u00e9"},
    )
    assert composed == precomposed
    assert len(composed) == 64
    assert b"Cafe" not in canonical_json_bytes("Caf\u00e9")
    with pytest.raises(ValueError, match="finite"):
        dataset_id(
            schema_version="1.0.0",
            parent_dataset_ids=(),
            recipe_id="import",
            recipe_version="1",
            parameters={"rate": float("nan")},
        )


def test_append_rejects_symlinked_internal_storage_directory(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    syndromes = storage.session_root / "normalized" / "syndromes"
    outside = tmp_path / "outside"
    outside.mkdir()
    syndromes.rmdir()
    syndromes.symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="symlink"):
        storage.append_batch(sample_batch())
    assert tuple(outside.iterdir()) == ()


def test_commit_verifies_detector_page_checksums(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(parquet_storage.PARQUET_OPTIONS, "compression", "NONE")
    storage = create_storage(tmp_path)
    detector_data = bytes(range(1, 33))
    pending = storage.append_batch(
        sample_batch(
            count=len(detector_data), detector_width=8, detector_data=detector_data
        )
    )
    _flip_scientific_page_byte(pending, detector_data)

    with pytest.raises(ValueError, match="checksum|Parquet"):
        storage.commit_segment("segment-0001")


def _flip_scientific_page_byte(path: Path, detector_data: bytes) -> None:
    payload = bytearray(path.read_bytes())
    offset = payload.find(detector_data)
    assert offset >= 0
    payload[offset + 7] ^= 0x01
    path.write_bytes(payload)


def test_verify_reads_detector_pages_with_checksum_verification(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(parquet_storage.PARQUET_OPTIONS, "compression", "NONE")
    storage = create_storage(tmp_path)
    detector_data = bytes(range(1, 33))
    storage.append_batch(
        sample_batch(
            count=len(detector_data), detector_width=8, detector_data=detector_data
        )
    )
    committed = storage.commit_segment("segment-0001")[0]
    _flip_scientific_page_byte(committed.path, detector_data)

    report = storage.verify()
    assert report.ok is False
    assert len(report.corrupt_committed) == 1


def test_recovery_capability_cannot_delete_or_resume_committed_data(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    committed = storage.commit_segment("segment-0001")[0]
    schema = pq.read_schema(committed.path)
    metadata = schema.metadata or {}
    forged = PendingPartition(
        path=committed.path,
        sha256=committed.sha256,
        rows=committed.rows,
        sequence_start=committed.sequence_start,
        sequence_end=committed.sequence_end,
        segment_id="segment-0001",
        dataset_id=metadata[b"qec.dataset_id"].decode(),
        schema_fingerprint=metadata[b"qec.schema_fingerprint"].decode(),
        is_final=True,
        journal_generation=1,
    )

    with pytest.raises(ValueError, match="authorized"):
        storage.discard_pending((forged,))
    with pytest.raises(ValueError, match="authorized"):
        storage.resume_pending((forged,))
    assert committed.path.exists()


def test_session_locks_are_never_evicted_for_a_live_identity(tmp_path: Path) -> None:
    session_path = str((tmp_path / "session-1").resolve())
    original = _session_lock(session_path)
    for index in range(300):
        _session_lock(str((tmp_path / f"other-{index}").resolve()))
    assert _session_lock(session_path) is original


def test_concurrent_lock_lookup_never_yields_two_live_locks(tmp_path: Path) -> None:
    session_path = str((tmp_path / "session-1").resolve())
    ready = threading.Barrier(16)
    retained: list[object] = []

    def look_up() -> None:
        ready.wait()
        retained.append(_session_lock(session_path))

    threads = tuple(threading.Thread(target=look_up) for _ in range(16))
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len({id(lock) for lock in retained}) == 1


def test_create_requires_structured_semantic_provenance(tmp_path: Path) -> None:
    with pytest.raises(TypeError):
        SessionStorage.create(tmp_path, sample_session())  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="source"):
        replace(sample_identity(), source_sha256=())
    with pytest.raises(TypeError):
        DatasetSemanticIdentity(label="run-7")  # type: ignore[call-arg]


def test_semantic_identity_round_trips_strict_canonical_mapping() -> None:
    identity = sample_identity()
    assert DatasetSemanticIdentity.from_mapping(identity.to_mapping()) == identity
    with pytest.raises(ValueError, match="canonical QEC field"):
        replace(identity, mapping=(("label", "run-7"),))
    with pytest.raises(ValueError, match="positive"):
        replace(identity, bit_widths=(("detectors", 0),))
    with pytest.raises(ValueError, match="time domain"):
        replace(identity, time_domain="wall-clock")
    invalid = identity.to_mapping()
    invalid["extra"] = "forbidden"
    with pytest.raises(ValueError, match="extra"):
        DatasetSemanticIdentity.from_mapping(invalid)


def test_dataset_identity_changes_with_canonical_source_hash(tmp_path: Path) -> None:
    first_root = tmp_path / "first"
    second_root = tmp_path / "second"
    first = SessionStorage.create(
        first_root, sample_session(), sample_identity("a" * 64)
    )
    second = SessionStorage.create(
        second_root, sample_session(), sample_identity("b" * 64)
    )
    first_pending = first.append_batch(sample_batch())
    second_pending = second.append_batch(sample_batch())

    first_id = (pq.read_schema(first_pending).metadata or {})[b"qec.dataset_id"]
    second_id = (pq.read_schema(second_pending).metadata or {})[b"qec.dataset_id"]
    assert first_id != second_id


def _copy_candidate(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    return target


def test_recovery_quarantines_overlap_and_schema_conflicts(tmp_path: Path) -> None:
    storage = create_storage(tmp_path / "primary")
    storage.append_batch(sample_batch())
    storage.commit_segment("segment-0001")
    donor = create_storage(tmp_path / "donor", "donor")
    overlap = donor.append_batch(sample_batch(start=2, session_id="donor"))
    schema_donor = create_storage(tmp_path / "schema-donor", "schema-donor")
    conflict = schema_donor.append_batch(
        sample_batch(start=5, detector_width=8, session_id="schema-donor")
    )
    segment = storage.session_root / "normalized" / "syndromes" / "segment-0001"
    _copy_candidate(overlap, segment / overlap.name)
    _copy_candidate(conflict, segment / conflict.name)

    report = storage.recover()
    assert len(report.quarantined) == 2
    assert report.resumable == ()
    assert all(item.quarantine_path.exists() for item in report.quarantined)


def test_recovery_quarantines_corrupt_orphan_final(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    segment = storage.session_root / "normalized" / "syndromes" / "segment-0001"
    segment.mkdir()
    corrupt = segment / "corrupt.parquet"
    corrupt.write_bytes(b"not parquet")

    report = storage.recover()
    assert len(report.quarantined) == 1
    assert report.quarantined[0].original_path == corrupt
    assert not corrupt.exists()


def test_recovery_treats_exact_pending_duplicate_as_idempotent(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    committed = storage.commit_segment("segment-0001")[0]
    duplicate = committed.path.with_suffix(".parquet.pending")
    shutil.copyfile(committed.path, duplicate)

    report = storage.recover()
    assert len(report.duplicates) == 1
    assert report.resumable == ()
    assert storage.resume_pending(report.duplicates) == ()
    assert not duplicate.exists()
    assert committed.path.exists()


def test_durable_json_reads_reject_duplicate_keys_and_nonfinite_values(
    tmp_path: Path,
) -> None:
    storage = create_storage(tmp_path)
    journal = storage.session_root / "journal.json"
    original = journal.read_text()
    journal.write_text(
        original.replace('"generation":0', '"generation":0,"generation":0')
    )
    assert storage.recover().fatal_error is not None

    journal.write_text(original.replace('"generation":0', '"generation":NaN'))
    assert storage.recover().fatal_error is not None

    journal.write_text(original.replace('"generation":0', '"generation":1e400'))
    assert storage.recover().fatal_error is not None
