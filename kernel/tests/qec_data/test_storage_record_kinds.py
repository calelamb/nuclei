from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
import pyarrow.parquet as pq

from kernel.qec_data.adapters.base import ImportChunk, SourceSpan
from kernel.qec_data.catalog import QecCatalog
from kernel.qec_data.hashing import DatasetSemanticIdentity
from kernel.qec_data.model_codecs import canonical_json_document
from kernel.qec_data.models import (
    CalibrationBatch,
    CalibrationRecord,
    CalibrationScope,
    CalibrationScopeKind,
    CampaignPointBatch,
    CampaignPointRecord,
    IndexRange,
)
from kernel.qec_data.queries import CancellationToken, QecQueryEngine, QueryNotSupported
from kernel.qec_data.storage import SegmentKey, SessionStorage
from kernel.qec_data.storage_parquet import inspect_partition
from kernel.qec_data.tiles import QueryTile
from kernel.tests.qec_data.test_queries import query_spec
from kernel.tests.qec_data.test_storage import (
    create_storage,
    sample_batch,
    sample_session,
)


def test_new_storage_uses_lineage_capable_journal_v2(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)

    journal = json.loads((storage.session_root / "journal.json").read_text())

    assert journal["journal_schema"] == "qec-storage-journal/2"


def _span(source_id: str = "source") -> SourceSpan:
    return SourceSpan(source_id, (IndexRange(10, 80),), IndexRange(1, 2))


def _campaign(*, segment_id: str = "shared") -> CampaignPointBatch:
    record = CampaignPointRecord(
        shots=100,
        errors=3,
        discards=2,
        seconds=1.25,
        decoder="pymatching",
        strong_id="point-1",
        json_metadata=canonical_json_document({"d": 3, "p": 0.001}),
        custom_counts=canonical_json_document({"timeouts": 1}),
    )
    return CampaignPointBatch(
        "campaign-batch",
        "session-1",
        segment_id,
        0,
        1,
        1,
        (record,),
        "provenance-1",
    )


def _calibration(*, segment_id: str = "shared") -> CalibrationBatch:
    record = CalibrationRecord.minimal(
        calibration_id="cal-1",
        session_id="session-1",
        scope=CalibrationScope(CalibrationScopeKind.QUBIT, "q0"),
        parameter_name="T1",
        semantic_id="vendor.example/t1",
        source_system="lab-db",
        provenance_id="provenance-1",
    )
    return CalibrationBatch(
        "calibration-batch",
        "session-1",
        segment_id,
        0,
        1,
        1,
        (record,),
        "provenance-1",
    )


def test_typed_chunks_round_trip_lineage_and_commit_atomically(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    chunks = (
        ImportChunk(sample_batch(segment_id="shared"), (_span("shots"),)),
        ImportChunk(_campaign(), (_span("stats"),)),
        ImportChunk(_calibration(), (_span("calibration"),)),
    )

    pending = tuple(storage.append_chunk(chunk) for chunk in chunks)
    assert {inspect_partition(path).record_kind for path in pending} == {
        "syndromes",
        "campaign_points",
        "calibrations",
    }
    assert tuple(inspect_partition(path).source_spans for path in pending) == tuple(
        chunk.source_spans for chunk in chunks
    )
    assert storage.list_committed_partitions() == ()

    committed = storage.commit_segments(
        (
            SegmentKey("syndromes", "shared"),
            SegmentKey("campaign_points", "shared"),
            SegmentKey("calibrations", "shared"),
        )
    )

    assert len(committed) == 3
    assert tuple(ref.source_spans for ref in committed) == tuple(
        chunk.source_spans for chunk in chunks
    )
    journal = json.loads((storage.session_root / "journal.json").read_text())
    assert journal["generation"] == 1
    assert {segment["record_kind"] for segment in journal["segments"]} == {
        "syndromes",
        "campaign_points",
        "calibrations",
    }


def test_overlap_is_scoped_by_record_kind(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_chunk(ImportChunk(_campaign(), (_span("stats"),)))
    storage.commit_segment("shared", record_kind="campaign_points")

    storage.append_chunk(ImportChunk(_calibration(), (_span("calibration"),)))
    storage.commit_segment("shared", record_kind="calibrations")

    with pytest.raises(ValueError, match="overlap"):
        storage.append_chunk(
            ImportChunk(replace(_campaign(), segment_id="other"), (_span("again"),))
        )


def _tile(events: list[object]) -> QueryTile:
    return next(event for event in events if isinstance(event, QueryTile))


def test_catalog_and_table_queries_dispatch_typed_record_kinds(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_chunk(ImportChunk(_campaign(), (_span("stats"),)))
    storage.append_chunk(ImportChunk(_calibration(), (_span("calibration"),)))
    storage.commit_segments(
        (
            SegmentKey("campaign_points", "shared"),
            SegmentKey("calibrations", "shared"),
        )
    )
    catalog = QecCatalog(storage)
    datasets = {item.record_kind: item for item in catalog.synchronize()}
    assert set(datasets) == {"campaign_points", "calibrations"}
    assert datasets["campaign_points"].schema_profile == "campaign-points-v1"
    assert datasets["calibrations"].schema_profile == "calibrations-v1"

    campaign = _tile(
        list(
            QecQueryEngine(catalog).execute(
                query_spec(datasets["campaign_points"].dataset_id),
                CancellationToken(),
            )
        )
    )
    calibration = _tile(
        list(
            QecQueryEngine(catalog).execute(
                query_spec(datasets["calibrations"].dataset_id),
                CancellationToken(),
            )
        )
    )
    assert campaign.tile.content["rows"][0]["shots"] == "100"
    assert calibration.tile.content["rows"][0]["calibrationId"] == "cal-1"

    with pytest.raises(QueryNotSupported):
        list(
            QecQueryEngine(catalog).execute(
                query_spec(
                    datasets["campaign_points"].dataset_id,
                    tile="heatmap",
                    filters={"start": 0, "end": 100},
                ),
                CancellationToken(),
            )
        )


def test_v1_journal_rejects_typed_record_kind_without_lineage(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_chunk(ImportChunk(_campaign(), (_span("stats"),)))
    storage.commit_segment("shared", record_kind="campaign_points")
    journal_path = storage.session_root / "journal.json"
    journal = json.loads(journal_path.read_text())
    journal["journal_schema"] = "qec-storage-journal/1"
    for partition in journal["segments"][0]["partitions"]:
        del partition["source_spans"]
    journal_path.write_text(json.dumps(journal))

    assert storage.recover().fatal_error == (
        "legacy journal record kind must be syndromes"
    )


def test_journal_lineage_must_match_parquet_lineage(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_chunk(ImportChunk(_campaign(), (_span("stats"),)))
    storage.commit_segment("shared", record_kind="campaign_points")
    journal_path = storage.session_root / "journal.json"
    journal = json.loads(journal_path.read_text())
    journal["segments"][0]["partitions"][0]["source_spans"][0][
        "source_id"
    ] = "substituted"
    journal_path.write_text(json.dumps(journal))

    report = storage.verify()
    assert report.ok is False
    assert len(report.corrupt_committed) == 1


def test_frozen_schema_and_dataset_domain_separators_are_stable(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    syndrome = storage.append_chunk(
        ImportChunk(sample_batch(segment_id="shared"), (_span("shots"),))
    )
    campaign = storage.append_chunk(ImportChunk(_campaign(), (_span("stats"),)))
    calibration = storage.append_chunk(
        ImportChunk(_calibration(), (_span("calibration"),))
    )

    metadata = [
        pq.read_schema(path).metadata or {}
        for path in (syndrome, campaign, calibration)
    ]
    assert metadata[0][b"qec.schema_fingerprint"].decode() == (
        "f7ffb11aa592d917f7c004c76a00f8a76e40c1a64b005d8babb7c2cb7640e35d"
    )
    assert metadata[0][b"qec.dataset_id"].decode() == (
        "1bda9b315f563721ec01221e02d3df053b8987da7cae68c0669effc8cd24c3b0"
    )
    assert metadata[1][b"qec.schema_fingerprint"].decode() == (
        "e87de639e42550a334e5819c624e5d1de994026fc50d5a0b81c6120d7cd198aa"
    )
    assert metadata[2][b"qec.schema_fingerprint"].decode() == (
        "ea44e7070b4367f5f08b89ccf418bcda6237e982aff683e1781009b601778072"
    )
    assert metadata[1][b"qec.dataset_id"] != metadata[2][b"qec.dataset_id"]


def test_typed_semantic_identities_allow_kind_appropriate_empty_fields(
    tmp_path: Path,
) -> None:
    campaign_identity = DatasetSemanticIdentity(
        source_sha256=("a" * 64,),
        adapter_id="generic.binary",
        adapter_version="1.0.0",
        mapping=(("shots", "num_shots"), ("errors", "num_errors")),
        bit_widths=(),
        units=(),
        time_domain="custom",
    )
    calibration_identity = DatasetSemanticIdentity(
        source_sha256=("a" * 64,),
        adapter_id="generic.binary",
        adapter_version="1.0.0",
        mapping=(("calibration_id", "id"), ("parameter_name", "parameter")),
        bit_widths=(),
        units=(),
        time_domain="custom",
    )

    campaign = SessionStorage.create(
        tmp_path / "campaign", sample_session(), campaign_identity
    )
    calibration = SessionStorage.create(
        tmp_path / "calibration", sample_session(), calibration_identity
    )

    assert campaign_identity != calibration_identity
    assert SessionStorage.open(tmp_path / "campaign", "session-1").session_root == (
        campaign.session_root
    )
    assert SessionStorage.open(tmp_path / "calibration", "session-1").session_root == (
        calibration.session_root
    )
