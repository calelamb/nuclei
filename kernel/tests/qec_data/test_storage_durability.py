from __future__ import annotations

import ctypes
import errno
import os
from pathlib import Path

import pytest

import kernel.qec_data.storage_durability as durability
from kernel.qec_data.storage import SessionStorage
from kernel.qec_data.storage_durability import (
    MOVEFILE_REPLACE_EXISTING,
    MOVEFILE_WRITE_THROUGH,
    DurabilityError,
    DurableMover,
)
from kernel.tests.qec_data.test_storage import (
    create_storage,
    sample_batch,
    sample_identity,
    sample_session,
)


def test_pending_and_nested_directories_are_synced(tmp_path: Path) -> None:
    synced: list[Path] = []
    mover = DurableMover(platform="posix", directory_sync=synced.append)
    storage = SessionStorage.create(
        tmp_path, sample_session(), sample_identity(), mover=mover
    )
    pending = storage.append_batch(sample_batch())

    synced_names = {path.name for path in synced}
    assert {
        "raw",
        "normalized",
        "syndromes",
        "derived",
        "indexes",
        "quarantine",
    } <= synced_names
    assert pending.parent in synced


def test_posix_durable_move_syncs_every_affected_directory(tmp_path: Path) -> None:
    source_parent = tmp_path / "source"
    target_parent = tmp_path / "target"
    source_parent.mkdir()
    target_parent.mkdir()
    source = source_parent / "partition.pending"
    target = target_parent / "partition"
    source.write_bytes(b"payload")
    synced: list[Path] = []
    mover = DurableMover(platform="posix", directory_sync=synced.append)

    mover.move(source, target)

    assert target.read_bytes() == b"payload"
    assert synced == [source_parent, target_parent]


@pytest.mark.parametrize("failed_sync", [0, 1])
def test_posix_move_fails_closed_when_either_directory_cannot_sync(
    tmp_path: Path, failed_sync: int
) -> None:
    source_parent = tmp_path / "source"
    target_parent = tmp_path / "target"
    source_parent.mkdir()
    target_parent.mkdir()
    source = source_parent / "partition.pending"
    target = target_parent / "partition"
    source.write_bytes(b"payload")
    synced: list[Path] = []

    def injected_sync(path: Path) -> bool:
        synced.append(path)
        return len(synced) - 1 != failed_sync

    mover = DurableMover(platform="posix", directory_sync=injected_sync)
    with pytest.raises(
        DurabilityError,
        match="visibility move completed.*durability is not guaranteed",
    ):
        mover.move(source, target)

    assert target.read_bytes() == b"payload"
    assert synced == [source_parent, target_parent][: failed_sync + 1]


def test_windows_durable_move_uses_native_write_through_flags(tmp_path: Path) -> None:
    calls: list[tuple[Path, Path, int]] = []

    def native_move(source: Path, target: Path, flags: int) -> None:
        calls.append((source, target, flags))
        operation = os.replace if flags & MOVEFILE_REPLACE_EXISTING else os.rename
        operation(source, target)

    mover = DurableMover(platform="nt", windows_move=native_move)
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.write_bytes(b"first")
    mover.move(source, target)
    replacement = tmp_path / "replacement"
    replacement.write_bytes(b"second")
    mover.move(replacement, target, replace_existing=True)

    assert [flags for _, _, flags in calls] == [
        MOVEFILE_WRITE_THROUGH,
        MOVEFILE_WRITE_THROUGH | MOVEFILE_REPLACE_EXISTING,
    ]
    assert target.read_bytes() == b"second"


def test_windows_native_move_errors_fail_closed(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.write_bytes(b"payload")
    mover = DurableMover(platform="nt", windows_move=lambda *_args: False)

    with pytest.raises(OSError, match="reported failure"):
        mover.move(source, target)

    assert source.read_bytes() == b"payload"
    assert not target.exists()

    def raise_native_error(*_args: object) -> None:
        raise OSError("native move failed")

    mover = DurableMover(platform="nt", windows_move=raise_native_error)
    with pytest.raises(OSError, match="native move failed"):
        mover.move(source, target)


def test_direct_windows_api_wrapper_checks_native_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeFunction:
        argtypes: object = None
        restype: object = None

        def __init__(self, result: bool) -> None:
            self.result = result

        def __call__(self, *_args: object) -> bool:
            return self.result

    class FakeKernel:
        def __init__(self, result: bool) -> None:
            self.MoveFileExW = FakeFunction(result)

    monkeypatch.setattr(
        ctypes, "WinDLL", lambda *_a, **_k: FakeKernel(True), raising=False
    )
    assert durability._move_file_ex_windows(
        tmp_path / "source", tmp_path / "target", MOVEFILE_WRITE_THROUGH
    )

    monkeypatch.setattr(ctypes, "WinDLL", lambda *_a, **_k: FakeKernel(False))
    monkeypatch.setattr(ctypes, "get_last_error", lambda: 5, raising=False)
    monkeypatch.setattr(
        ctypes, "WinError", lambda code: OSError(code, "native failure"), raising=False
    )
    with pytest.raises(OSError, match="native failure"):
        durability._move_file_ex_windows(
            tmp_path / "source", tmp_path / "target", MOVEFILE_WRITE_THROUGH
        )


def test_directory_fsync_rejects_windows_and_handles_unsupported_posix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(durability.os, "name", "nt")
    with pytest.raises(OSError, match="only supported on POSIX"):
        durability.fsync_directory(tmp_path)

    monkeypatch.setattr(durability.os, "name", "posix")

    def unsupported_open(*_args: object) -> int:
        raise OSError(errno.EINVAL, "unsupported")

    monkeypatch.setattr(durability.os, "open", unsupported_open)
    assert durability.fsync_directory(tmp_path) is False


def test_unknown_platform_fails_closed(tmp_path: Path) -> None:
    mover = DurableMover(platform="unknown")
    with pytest.raises(OSError, match="unsupported storage platform"):
        mover.sync_directory(tmp_path)
    with pytest.raises(OSError, match="unsupported storage platform"):
        mover.move(tmp_path / "source", tmp_path / "target")


def _assert_windows_boundary_flags(calls: list[tuple[Path, Path, int]]) -> None:
    targets = [target.name for _, target, _ in calls]
    assert {"manifest.json", "identity.json", "journal.json", "session-1"} <= set(
        targets
    )
    assert any(name.endswith(".parquet") for name in targets)
    assert any(target.parent.name == "quarantine" for _, target, _ in calls)
    assert any(name.endswith(".pending") for name in targets)
    assert all(flags & MOVEFILE_WRITE_THROUGH for _, _, flags in calls)
    assert all(
        not flags & MOVEFILE_REPLACE_EXISTING
        for _, target, flags in calls
        if target.name != "journal.json"
    )
    journal_flags = [
        flags for _, target, flags in calls if target.name == "journal.json"
    ]
    assert journal_flags == [
        MOVEFILE_WRITE_THROUGH,
        MOVEFILE_WRITE_THROUGH | MOVEFILE_REPLACE_EXISTING,
    ]


def test_all_storage_visibility_moves_use_windows_write_through(
    tmp_path: Path,
) -> None:
    calls: list[tuple[Path, Path, int]] = []

    def native_move(source: Path, target: Path, flags: int) -> None:
        calls.append((source, target, flags))
        operation = os.replace if flags & MOVEFILE_REPLACE_EXISTING else os.rename
        operation(source, target)

    mover = DurableMover(platform="nt", windows_move=native_move)
    storage = SessionStorage.create(
        tmp_path,
        sample_session(),
        sample_identity(),
        mover=mover,
    )
    storage.append_batch(sample_batch())
    storage.commit_segment("segment-0001")

    segment = storage.session_root / "normalized" / "syndromes" / "segment-0001"
    corrupt = segment / "corrupt.parquet"
    corrupt.write_bytes(b"not parquet")
    report = storage.recover()
    assert len(report.quarantined) == 1

    pending = storage.append_batch(sample_batch(start=3, segment_id="segment-0002"))
    final = pending.with_suffix("")
    os.rename(pending, final)
    orphaned = storage.recover().orphaned_final
    assert storage.resume_pending(orphaned) == (pending,)

    _assert_windows_boundary_flags(calls)


@pytest.mark.skipif(os.name != "nt", reason="requires the Windows filesystem API")
def test_windows_native_write_through_storage_integration(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch())
    storage.commit_segment("segment-0001")

    assert storage.verify().ok
