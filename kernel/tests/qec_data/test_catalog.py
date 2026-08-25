from __future__ import annotations

import json
import shutil
from dataclasses import replace
from pathlib import Path

import duckdb
import pytest

from kernel.qec_data.catalog import CatalogIntegrityError, CatalogNotFound, QecCatalog
from kernel.qec_data.models import (
    IndexRange,
    PackedBits,
    QualifiedPackedBits,
    QualifiedRange,
    QualifiedTimestamps,
    TimestampSeries,
    ValueStatus,
)
from kernel.qec_data.storage import SessionStorage
from kernel.tests.qec_data.test_storage import (
    create_storage,
    sample_batch,
    sample_identity,
    sample_session,
)


def committed_storage(root: Path):
    storage = create_storage(root)
    storage.append_batch(sample_batch())
    storage.commit_segment("segment-0001")
    return storage


def test_catalog_uses_only_exact_journal_committed_partitions(tmp_path: Path) -> None:
    storage = committed_storage(tmp_path)
    pending = storage.append_batch(sample_batch(start=3, segment_id="segment-0002"))
    orphan = pending.with_suffix("")
    shutil.copyfile(pending, orphan)

    catalog = QecCatalog(storage)
    datasets = catalog.synchronize()

    assert len(datasets) == 1
    dataset = datasets[0]
    committed = storage.list_committed_partitions()
    assert dataset.partitions == tuple(ref.path for ref in committed)
    assert pending not in dataset.partitions
    assert orphan not in dataset.partitions
    assert dataset.semantic_identity["source_sha256"] == ["a" * 64]


def test_catalog_rebuilds_transactionally_when_generation_changes(
    tmp_path: Path,
) -> None:
    storage = committed_storage(tmp_path)
    catalog = QecCatalog(storage)
    first = catalog.synchronize()[0]
    assert first.journal_generation == 1

    storage.append_batch(sample_batch(start=3))
    storage.commit_segment("segment-0001")
    second = catalog.resolve(first.session_id, first.dataset_id)

    assert second.journal_generation == 2
    assert len(second.partitions) == 2


def test_catalog_cache_is_rebuildable_not_authoritative(tmp_path: Path) -> None:
    storage = committed_storage(tmp_path)
    catalog = QecCatalog(storage)
    dataset = catalog.synchronize()[0]
    with duckdb.connect(str(catalog.database_path)) as connection:
        connection.execute(
            "UPDATE datasets SET journal_generation = ? WHERE dataset_id = ?",
            [999, dataset.dataset_id],
        )

    rebuilt = catalog.resolve(dataset.session_id, dataset.dataset_id)

    assert rebuilt.journal_generation == 1


def test_catalog_rejects_unknown_or_injected_dataset_ids(tmp_path: Path) -> None:
    catalog = QecCatalog(committed_storage(tmp_path))
    catalog.synchronize()

    with pytest.raises(CatalogNotFound):
        catalog.resolve("session-1", "' OR TRUE; DROP TABLE datasets; --")
    assert len(catalog.synchronize()) == 1


def test_catalog_fails_closed_if_committed_snapshot_changes(tmp_path: Path) -> None:
    storage = committed_storage(tmp_path)
    journal_path = storage.session_root / "journal.json"
    journal = json.loads(journal_path.read_text())
    journal["segments"][0]["partitions"][0]["path"] = "missing.parquet"
    journal_path.write_text(json.dumps(journal))

    with pytest.raises(CatalogIntegrityError):
        QecCatalog(storage).synchronize()


def test_catalog_creates_bounded_cache_under_session_indexes(tmp_path: Path) -> None:
    storage = committed_storage(tmp_path)
    catalog = QecCatalog(storage)
    catalog.synchronize()

    assert catalog.database_path == storage.session_root / "indexes" / "catalog.duckdb"
    assert catalog.database_path.is_file()


@pytest.mark.parametrize(
    ("timestamps", "rounds", "profile"),
    [
        (False, False, "base"),
        (True, False, "timestamp"),
        (False, True, "round"),
        (True, True, "timestamp-round"),
    ],
)
def test_catalog_allowlists_each_syndrome_schema_profile(
    tmp_path: Path, timestamps: bool, rounds: bool, profile: str
) -> None:
    storage = create_storage(tmp_path)
    batch = sample_batch()
    if timestamps:
        batch = replace(
            batch,
            source_timestamps=QualifiedTimestamps(
                TimestampSeries((10.0, 11.0, 12.0), "ns"), ValueStatus.MEASURED
            ),
        )
    if rounds:
        batch = replace(
            batch,
            round_range=QualifiedRange(IndexRange(0, 3), ValueStatus.MEASURED),
        )
    storage.append_batch(batch)
    storage.commit_segment("segment-0001")

    assert QecCatalog(storage).synchronize()[0].schema_profile == profile


def test_catalog_rejects_symlinked_index_and_temp_boundaries(tmp_path: Path) -> None:
    storage = committed_storage(tmp_path)
    indexes = storage.session_root / "indexes"
    real_indexes = tmp_path / "real-indexes"
    indexes.rename(real_indexes)
    indexes.symlink_to(real_indexes, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        QecCatalog(storage)

    indexes.unlink()
    real_indexes.rename(indexes)
    catalog = QecCatalog(storage)
    temp_target = tmp_path / "external-temp"
    temp_target.mkdir()
    (indexes / "duckdb-tmp").symlink_to(temp_target, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        catalog.synchronize()


@pytest.mark.parametrize("name", ["journal.json", "manifest.json", "identity.json"])
def test_catalog_rejects_post_open_symlink_boundary_swap(
    tmp_path: Path, name: str
) -> None:
    storage = committed_storage(tmp_path / "session")
    catalog = QecCatalog(storage)
    boundary = storage.session_root / name
    external = tmp_path / f"external-{name}"
    external.write_bytes(boundary.read_bytes())
    boundary.unlink()
    boundary.symlink_to(external)

    with pytest.raises(CatalogIntegrityError, match="boundary"):
        catalog.synchronize()


def test_catalog_rejects_parquet_bit_width_metadata_identity_mismatch(
    tmp_path: Path,
) -> None:
    identity = replace(sample_identity(), bit_widths=(("detectors", 7),))
    storage = SessionStorage.create(tmp_path, sample_session(), identity)
    storage.append_batch(sample_batch(detector_width=8))
    storage.commit_segment("segment-0001")

    with pytest.raises(CatalogIntegrityError, match="snapshot"):
        QecCatalog(storage).synchronize()


@pytest.mark.parametrize("field", ["observables", "measurements"])
@pytest.mark.parametrize("physical_field", [False, True])
def test_catalog_rejects_optional_bit_field_presence_identity_mismatch(
    tmp_path: Path, field: str, physical_field: bool
) -> None:
    bit_widths = (("detectors", 9),)
    batch = sample_batch()
    if physical_field:
        batch = replace(
            batch,
            **{
                field: QualifiedPackedBits(
                    PackedBits(1, bytes(batch.record_count)), ValueStatus.MEASURED
                )
            },
        )
    else:
        bit_widths += ((field, 1),)
    identity = replace(sample_identity(), bit_widths=bit_widths)
    storage = SessionStorage.create(tmp_path, sample_session(), identity)
    storage.append_batch(batch)
    storage.commit_segment("segment-0001")

    with pytest.raises(CatalogIntegrityError, match="snapshot"):
        QecCatalog(storage).synchronize()
