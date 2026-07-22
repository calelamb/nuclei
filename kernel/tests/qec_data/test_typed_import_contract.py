from dataclasses import replace

import pytest

from kernel.qec_data.adapters.base import (
    AdapterCapability,
    AdapterManifest,
    ImportChunk,
    ImportMapping,
    PreviewResult,
    SourceSpan,
    SourceSpanPrecision,
    compute_source_sha256,
)
from kernel.qec_data.adapters.registry import AdapterRegistry
from kernel.qec_data.model_codecs import (
    calibration_batch_from_mapping,
    calibration_batch_to_mapping,
    campaign_point_batch_from_mapping,
    campaign_point_batch_to_mapping,
    canonical_json_document,
    import_chunk_from_mapping,
    import_chunk_to_mapping,
)
from kernel.qec_data.json_document import (
    MAX_CANONICAL_JSON_BYTES,
    MAX_CANONICAL_JSON_CONTAINER_ITEMS,
    MAX_CANONICAL_JSON_DEPTH,
    MAX_CANONICAL_JSON_KEYS,
    parse_canonical_json_document,
)
from kernel.qec_data.models import (
    CalibrationBatch,
    CalibrationRecord,
    CalibrationScope,
    CalibrationScopeKind,
    CampaignPointBatch,
    CampaignPointRecord,
    IndexRange,
)
from kernel.tests.qec_data.adapter_contract import (
    run_adapter_contract,
    trusted_process_group_backend,
)
from kernel.tests.qec_data.test_adapter_contract import GoodAdapter


def _campaign_batch(
    *,
    count: int = 1,
    provenance_id: str = "provenance-1",
    sequence_start: int = 0,
) -> CampaignPointBatch:
    records = tuple(
        CampaignPointRecord(
            shots=100,
            errors=3,
            discards=2,
            seconds=1.25,
            decoder="pymatching",
            strong_id=f"strong-{index}",
            json_metadata=canonical_json_document({"d": 3, "p": 0.001}),
            custom_counts=canonical_json_document({"timeouts": 1}),
        )
        for index in range(count)
    )
    return CampaignPointBatch(
        batch_id="campaign-batch",
        session_id="session-1",
        segment_id="aggregate",
        sequence_start=sequence_start,
        sequence_end=sequence_start + count,
        record_count=count,
        records=records,
        provenance_id=provenance_id,
    )


def _calibration_batch(
    *, provenance_id: str = "provenance-1", segment_id: str = "calibrations"
) -> CalibrationBatch:
    record = CalibrationRecord.minimal(
        calibration_id="cal-1",
        session_id="session-1",
        scope=CalibrationScope(CalibrationScopeKind.QUBIT, "q0"),
        parameter_name="T1",
        semantic_id="vendor.example/t1",
        source_system="lab-db",
        provenance_id=provenance_id,
    )
    return CalibrationBatch(
        batch_id="calibration-batch",
        session_id="session-1",
        segment_id=segment_id,
        sequence_start=0,
        sequence_end=1,
        record_count=1,
        records=(record,),
        provenance_id=provenance_id,
    )


def test_campaign_point_batch_is_aggregate_and_round_trips_losslessly() -> None:
    batch = _campaign_batch()
    record = batch.records[0]
    assert record.shots == 100
    assert record.errors == 3
    assert not hasattr(record, "detector_events")
    assert (
        campaign_point_batch_from_mapping(campaign_point_batch_to_mapping(batch))
        == batch
    )


def test_campaign_json_documents_are_canonical_safe_and_duplicate_free() -> None:
    assert canonical_json_document({"p": 0.001, "d": 3}) == '{"d":3,"p":0.001}'
    with pytest.raises(ValueError, match="duplicate"):
        CampaignPointRecord(1, 0, 0, 0.0, "d", "s", '{"d":3,"d":5}', "{}")
    with pytest.raises(ValueError, match="finite"):
        CampaignPointRecord(1, 0, 0, 0.0, "d", "s", '{"p":NaN}', "{}")
    with pytest.raises(ValueError, match="safe"):
        CampaignPointRecord(1, 0, 0, 0.0, "d", "s", '{"n":9007199254740992}', "{}")
    with pytest.raises(ValueError, match="canonical"):
        CampaignPointRecord(1, 0, 0, 0.0, "d", "s", '{"d": 3}', "{}")


@pytest.mark.parametrize(
    "custom_counts",
    ("[]", '"count"', '{"bad":-1}', '{"bad":1.5}', '{"bad":9007199254740992}'),
)
def test_custom_counts_requires_safe_nonnegative_integer_object(
    custom_counts: str,
) -> None:
    with pytest.raises((TypeError, ValueError), match="custom_counts"):
        CampaignPointRecord(1, 0, 0, 0.0, "d", "s", "{}", custom_counts)


def test_campaign_counts_and_batch_envelope_are_consistent() -> None:
    with pytest.raises(ValueError, match="errors and discards"):
        replace(_campaign_batch().records[0], errors=99, discards=2)
    with pytest.raises(ValueError, match="record_count"):
        replace(_campaign_batch(), record_count=2, sequence_end=2)


def test_calibration_batch_reuses_records_and_round_trips() -> None:
    batch = _calibration_batch()
    assert calibration_batch_from_mapping(calibration_batch_to_mapping(batch)) == batch
    with pytest.raises(ValueError, match="session_id"):
        replace(
            batch,
            records=(replace(batch.records[0], session_id="other-session"),),
        )


def test_source_span_supports_exact_and_container_byte_lineage() -> None:
    exact = SourceSpan(
        source_id="capture",
        row_range=IndexRange(1, 3),
        byte_ranges=(IndexRange(24, 80), IndexRange(100, 120)),
    )
    assert exact.precision is SourceSpanPrecision.EXACT
    assert (
        SourceSpan(
            source_id="parquet",
            byte_ranges=(IndexRange(0, 4096),),
            precision=SourceSpanPrecision.CONTAINER,
        ).row_range
        is None
    )
    with pytest.raises(ValueError, match="ordered and non-overlapping"):
        replace(exact, byte_ranges=(IndexRange(24, 80), IndexRange(70, 90)))
    with pytest.raises(ValueError, match="at most 65,536"):
        _campaign_batch(count=65_537)


def test_lineage_collections_are_bounded() -> None:
    ranges = tuple(IndexRange(index * 2, index * 2 + 1) for index in range(1_025))
    with pytest.raises(ValueError, match="at most 1,024"):
        SourceSpan("capture", ranges)
    span = SourceSpan("capture", (IndexRange(0, 1),))
    with pytest.raises(ValueError, match="at most 1,024"):
        ImportChunk(_campaign_batch(), (span,) * 1_025)
    too_many_ranges = (
        SourceSpan(
            "capture", tuple(IndexRange(i * 2, i * 2 + 1) for i in range(1_024))
        ),
        SourceSpan(
            "capture-2",
            tuple(IndexRange(i * 2, i * 2 + 1) for i in range(1_024)),
        ),
        SourceSpan("capture-3", (IndexRange(0, 1),)),
    )
    with pytest.raises(ValueError, match="total source ranges"):
        ImportChunk(_campaign_batch(), too_many_ranges)


def test_import_chunk_composes_lineage_under_one_64_kib_budget() -> None:
    spans = tuple(
        SourceSpan(
            f"source-{'x' * 48}-{index}",
            (IndexRange(index * 2, index * 2 + 1),),
        )
        for index in range(600)
    )
    with pytest.raises(ValueError, match="64 KiB"):
        ImportChunk(_campaign_batch(), spans)


def test_canonical_json_documents_enforce_resource_limits() -> None:
    with pytest.raises(ValueError, match="64 KiB"):
        canonical_json_document({"value": "x" * MAX_CANONICAL_JSON_BYTES})
    too_deep = (
        "[" * (MAX_CANONICAL_JSON_DEPTH + 1)
        + "0"
        + "]" * (MAX_CANONICAL_JSON_DEPTH + 1)
    )
    with pytest.raises(ValueError, match="depth"):
        parse_canonical_json_document("json_metadata", too_deep)
    too_many_keys = {f"k{index}": 0 for index in range(MAX_CANONICAL_JSON_KEYS + 1)}
    with pytest.raises(ValueError, match="keys"):
        canonical_json_document(too_many_keys)
    too_many_items = [0] * (MAX_CANONICAL_JSON_CONTAINER_ITEMS + 1)
    with pytest.raises(ValueError, match="container items"):
        canonical_json_document(too_many_items)


def test_import_chunk_round_trip_discriminates_payload_kind() -> None:
    span = SourceSpan("stats", (IndexRange(20, 90),), IndexRange(1, 2))
    for payload, kind in (
        (_campaign_batch(), "campaign_points"),
        (_calibration_batch(), "calibrations"),
    ):
        chunk = ImportChunk(payload=payload, source_spans=(span,))
        mapping = import_chunk_to_mapping(chunk)
        assert mapping["record_kind"] == kind
        assert import_chunk_from_mapping(mapping) == chunk


def test_manifest_output_kinds_are_additive_and_legacy_defaults_to_syndromes() -> None:
    capabilities = frozenset(
        {
            AdapterCapability.PROBE,
            AdapterCapability.VALIDATE,
            AdapterCapability.PREVIEW,
            AdapterCapability.IMPORT,
        }
    )
    legacy = AdapterManifest("legacy", "1", capabilities, ("dets",))
    assert legacy.output_kinds == ("syndromes",)
    typed = replace(legacy, output_kinds=("campaign_points", "calibrations"))
    assert typed.output_kinds == ("campaign_points", "calibrations")
    with pytest.raises(ValueError, match="output kinds"):
        replace(legacy, output_kinds=("invented",))


def test_payloads_expose_authoritative_durable_record_kinds() -> None:
    assert _campaign_batch().record_kind == "campaign_points"
    assert _calibration_batch().record_kind == "calibrations"


class TypedCampaignAdapter(GoodAdapter):
    manifest = replace(
        GoodAdapter.manifest,
        id="test.typed-campaign",
        output_kinds=("campaign_points",),
    )

    @staticmethod
    def _chunk() -> ImportChunk:
        return ImportChunk(
            _campaign_batch(provenance_id="contract-provenance"),
            (SourceSpan("stats", (IndexRange(0, 10),), IndexRange(1, 2)),),
        )

    def preview(self, source, mapping: ImportMapping, limit: int) -> PreviewResult:
        return PreviewResult(
            batches=(self._chunk(),) if limit else (),
            truncated=False,
            total_records=1 if limit else 0,
            source_sha256=compute_source_sha256(source),
            provenance_id="contract-provenance",
        )

    def import_batches(self, source, mapping: ImportMapping):
        return iter((self._chunk(),))


class UndeclaredCampaignAdapter(TypedCampaignAdapter):
    manifest = replace(
        TypedCampaignAdapter.manifest,
        id="broken.undeclared-campaign",
        output_kinds=("syndromes",),
    )


class BareCampaignAdapter(TypedCampaignAdapter):
    manifest = replace(TypedCampaignAdapter.manifest, id="broken.bare-campaign")

    def import_batches(self, source, mapping: ImportMapping):
        return iter((_campaign_batch(),))


def _typed_chunk(
    sequence_start: int,
    source_spans: tuple[SourceSpan, ...],
) -> ImportChunk:
    return ImportChunk(
        _campaign_batch(
            provenance_id="contract-provenance", sequence_start=sequence_start
        ),
        source_spans,
    )


class _TwoChunkCampaignAdapter(TypedCampaignAdapter):
    chunks: tuple[ImportChunk, ...] = ()

    def preview(self, source, mapping: ImportMapping, limit: int) -> PreviewResult:
        batches = self.chunks[:1] if limit else ()
        return PreviewResult(
            batches=batches,
            truncated=True,
            total_records=len(self.chunks),
            source_sha256=compute_source_sha256(source),
            provenance_id="contract-provenance",
        )

    def import_batches(self, source, mapping: ImportMapping):
        return iter(self.chunks)


class GappedCampaignAdapter(_TwoChunkCampaignAdapter):
    manifest = replace(TypedCampaignAdapter.manifest, id="broken.gapped-campaign")
    chunks = (
        _typed_chunk(0, (SourceSpan("a", (IndexRange(0, 10),)),)),
        _typed_chunk(2, (SourceSpan("a", (IndexRange(10, 20),)),)),
    )


class ExactOverlapCampaignAdapter(_TwoChunkCampaignAdapter):
    manifest = replace(TypedCampaignAdapter.manifest, id="broken.exact-overlap")
    chunks = (
        _typed_chunk(0, (SourceSpan("a", (IndexRange(0, 10),)),)),
        _typed_chunk(1, (SourceSpan("a", (IndexRange(5, 15),)),)),
    )


class ContainerOverlapCampaignAdapter(_TwoChunkCampaignAdapter):
    manifest = replace(TypedCampaignAdapter.manifest, id="test.container-overlap")
    chunks = (
        _typed_chunk(0, (SourceSpan("a", (IndexRange(0, 10),)),)),
        _typed_chunk(
            1,
            (
                SourceSpan(
                    "a",
                    (IndexRange(0, 10),),
                    precision=SourceSpanPrecision.CONTAINER,
                ),
            ),
        ),
    )


class ExactNonmonotonicCampaignAdapter(_TwoChunkCampaignAdapter):
    manifest = replace(TypedCampaignAdapter.manifest, id="broken.exact-order")
    chunks = (
        _typed_chunk(0, (SourceSpan("a", (IndexRange(100, 110),)),)),
        _typed_chunk(1, (SourceSpan("a", (IndexRange(0, 10),)),)),
    )


class IndependentSourcesCampaignAdapter(_TwoChunkCampaignAdapter):
    manifest = replace(TypedCampaignAdapter.manifest, id="test.independent-sources")
    chunks = (
        _typed_chunk(
            0,
            (
                SourceSpan("a", (IndexRange(0, 5), IndexRange(10, 15))),
                SourceSpan("b", (IndexRange(100, 110),)),
            ),
        ),
        _typed_chunk(
            1,
            (
                SourceSpan("b", (IndexRange(110, 120),)),
                SourceSpan("a", (IndexRange(15, 20), IndexRange(25, 30))),
            ),
        ),
    )


class ExactRowOverlapCampaignAdapter(_TwoChunkCampaignAdapter):
    manifest = replace(TypedCampaignAdapter.manifest, id="broken.exact-row-overlap")
    chunks = (
        _typed_chunk(
            0,
            (SourceSpan("a", (IndexRange(0, 10),), IndexRange(1, 3)),),
        ),
        _typed_chunk(
            1,
            (SourceSpan("a", (IndexRange(10, 20),), IndexRange(2, 4)),),
        ),
    )


class CrossKindSourceReuseAdapter(_TwoChunkCampaignAdapter):
    manifest = replace(
        TypedCampaignAdapter.manifest,
        id="test.cross-kind-source-reuse",
        output_kinds=("campaign_points", "calibrations"),
    )
    chunks = (
        _typed_chunk(0, (SourceSpan("shared", (IndexRange(0, 10),)),)),
        ImportChunk(
            _calibration_batch(provenance_id="contract-provenance"),
            (SourceSpan("shared", (IndexRange(0, 10),)),),
        ),
    )


def _compliance(adapter_factory, source):
    return run_adapter_contract(
        adapter_factory,
        source,
        isolation_backend=trusted_process_group_backend(),
    )


def test_compliance_accepts_declared_typed_chunks(tmp_path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text("stats", encoding="utf-8")
    assert _compliance(TypedCampaignAdapter, source).passed


def test_compliance_rejects_undeclared_kind_and_bare_new_payload(tmp_path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text("stats", encoding="utf-8")
    undeclared = _compliance(UndeclaredCampaignAdapter, source)
    assert "batch_output_kind_undeclared" in undeclared.failure_codes
    bare = _compliance(BareCampaignAdapter, source)
    assert "batch_type_invalid" in bare.failure_codes


def test_typed_batch_sequences_must_be_contiguous(tmp_path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text("stats", encoding="utf-8")
    report = _compliance(GappedCampaignAdapter, source)
    assert "batch_sequence_gap" in report.failure_codes


def test_compliance_rejects_overlapping_exact_source_bytes(tmp_path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text("stats", encoding="utf-8")
    report = _compliance(ExactOverlapCampaignAdapter, source)
    assert "source_span_exact_overlap" in report.failure_codes
    assert _compliance(ContainerOverlapCampaignAdapter, source).passed


def test_exact_span_order_is_per_source_and_preserves_multi_ranges(tmp_path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text("stats", encoding="utf-8")
    nonmonotonic = _compliance(ExactNonmonotonicCampaignAdapter, source)
    assert "source_span_exact_nonmonotonic" in nonmonotonic.failure_codes
    assert _compliance(IndependentSourcesCampaignAdapter, source).passed


def test_exact_span_scope_and_row_order_are_semantic(tmp_path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text("stats", encoding="utf-8")
    row_overlap = _compliance(ExactRowOverlapCampaignAdapter, source)
    assert "source_span_exact_row_overlap" in row_overlap.failure_codes
    assert _compliance(CrossKindSourceReuseAdapter, source).passed


def test_registry_snapshot_preserves_declared_output_kinds() -> None:
    registered = AdapterRegistry().register(TypedCampaignAdapter())
    assert registered.registrations[0].manifest.output_kinds == ("campaign_points",)
