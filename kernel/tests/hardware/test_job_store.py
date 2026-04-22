"""JobStore persistence tests — uses tmp_path so no real home-dir I/O."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone

import pytest

from kernel.hardware.job_store import (
    JobRecord,
    JobStore,
    MAX_ENTRIES,
    TERMINAL_TTL_SECONDS,
)


def _make_record(
    job_id: str,
    *,
    status: str = "queued",
    submitted_at: str | None = None,
    last_updated_at: str | None = None,
    provider: str = "ibm",
    backend: str = "ibm_brisbane",
    shots: int = 1024,
    error: str | None = None,
) -> JobRecord:
    submitted = submitted_at or datetime.now(timezone.utc).isoformat()
    return JobRecord(
        job_id=job_id,
        provider=provider,
        backend=backend,
        status=status,
        shots=shots,
        submitted_at=submitted,
        last_updated_at=last_updated_at or submitted,
        error=error,
    )


@pytest.fixture
def store(tmp_path):
    return JobStore(path=str(tmp_path / "jobs.json"))


def test_save_and_load_roundtrip(store):
    record = _make_record("abc-123", status="running")
    store.upsert(record)

    reopened = JobStore(path=store.path)
    reopened.load()
    assert [r.job_id for r in reopened.all()] == ["abc-123"]
    assert reopened.get("abc-123").status == "running"


def test_load_handles_missing_file(tmp_path):
    store = JobStore(path=str(tmp_path / "no-such.json"))
    store.load()
    assert store.all() == []


def test_load_handles_corrupt_file(tmp_path):
    path = tmp_path / "jobs.json"
    path.write_text("not valid json!", encoding="utf-8")
    store = JobStore(path=str(path))
    store.load()
    # Starts fresh rather than crashing.
    assert store.all() == []


def test_update_status_writes_through(store):
    store.upsert(_make_record("abc"))
    store.update_status("abc", status="complete")
    assert store.get("abc").status == "complete"
    # Also present after reload.
    reopened = JobStore(path=store.path)
    reopened.load()
    assert reopened.get("abc").status == "complete"


def test_update_status_for_unknown_job_is_noop(store):
    store.update_status("never-seen", status="complete")
    assert store.all() == []


def test_remove_deletes_entry(store):
    store.upsert(_make_record("x"))
    store.upsert(_make_record("y"))
    store.remove("x")
    assert [r.job_id for r in store.all()] == ["y"]


def test_prune_drops_old_terminal_jobs(store):
    # Fresh complete job — keeps
    fresh = _make_record("fresh", status="complete")
    # Old complete job — prunes
    old_ts = (datetime.now(timezone.utc) - timedelta(seconds=TERMINAL_TTL_SECONDS + 60)).isoformat()
    old = _make_record("old", status="complete", submitted_at=old_ts, last_updated_at=old_ts)
    # Old running job — KEEPS (not terminal, so TTL doesn't apply)
    old_running = _make_record("running", status="running", submitted_at=old_ts, last_updated_at=old_ts)

    store._records = {r.job_id: r for r in [fresh, old, old_running]}
    store.save()

    reopened = JobStore(path=store.path)
    reopened.load()
    surviving_ids = {r.job_id for r in reopened.all()}
    assert "fresh" in surviving_ids
    assert "running" in surviving_ids
    assert "old" not in surviving_ids


def test_prune_enforces_max_entries(store):
    # Write one more than the cap, all terminal + recent; the oldest
    # should be pruned.
    now = datetime.now(timezone.utc)
    for i in range(MAX_ENTRIES + 5):
        ts = (now - timedelta(seconds=MAX_ENTRIES + 5 - i)).isoformat()
        store._records[str(i)] = _make_record(
            str(i), status="complete", submitted_at=ts, last_updated_at=ts,
        )
    store.save()

    reopened = JobStore(path=store.path)
    reopened.load()
    assert len(reopened.all()) == MAX_ENTRIES
    ids = {r.job_id for r in reopened.all()}
    # Newest survive, oldest go.
    for i in range(5):
        assert str(i) not in ids
    for i in range(5, MAX_ENTRIES + 5):
        assert str(i) in ids


def test_atomic_write_leaves_intact_on_simulated_failure(monkeypatch, store):
    """If the write to the temp file fails, the original must remain.
    We seed an existing file, then force os.replace to raise."""
    store.upsert(_make_record("pre-existing"))

    def boom(src, dst):
        raise OSError("disk full simulated")

    monkeypatch.setattr(os, "replace", boom)
    # Attempt a write — should NOT crash the process.
    store.upsert(_make_record("attempt-two"))

    # Reload with real os.replace — pre-existing should still be readable.
    fresh = JobStore(path=store.path)
    fresh.load()
    assert fresh.get("pre-existing") is not None


def test_nuclei_data_dir_env_override(monkeypatch, tmp_path):
    """NUCLEI_DATA_DIR redirects the default path so users can keep the
    registry in, say, a sandboxed app support directory."""
    monkeypatch.setenv("NUCLEI_DATA_DIR", str(tmp_path))
    from kernel.hardware.job_store import _default_path

    assert _default_path().startswith(str(tmp_path))
