from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

import pytest

import kernel.qec_data.adapters.tabular_sources as tabular_sources

from kernel.qec_data.adapters.base import (
    ImportChunk,
    ImportMapping,
    SourceSpan,
    SourceSpanPrecision,
)
from kernel.qec_data.adapters.registry import core_offline_registry
from kernel.qec_data.adapters.sinter_csv import SinterCsvAdapter
from kernel.qec_data.adapters.stim_results import StimResultsAdapter
from kernel.qec_data.adapters.tabular import TabularAdapter
from kernel.qec_data.model_validation import DataQualityFlag, ValueStatus
from kernel.qec_data.server import _semantic_identity
from kernel.qec_data.models import (
    CalibrationBatch,
    CalibrationQuality,
    CalibrationScopeKind,
    IndexRange,
    SyndromeBatch,
)
from kernel.tests.qec_data.adapter_contract import (
    run_adapter_contract,
    trusted_process_group_backend,
)


def _mapping(*, with_time: bool = True) -> ImportMapping:
    fields = (("sequence", "seq"), ("detector_events", "syndrome"))
    options: tuple[tuple[str, object], ...] = (
        ("output_kind", "syndromes"),
        ("detector_count", 3),
        ("bit_order", "lsb0"),
        ("session_id", "hardware-run"),
        ("segment_id", "segment-a"),
    )
    if with_time:
        fields += (("timestamp", "clock"),)
        options += (("timestamp_unit", "ns"),)
    return ImportMapping(
        fields=fields,
        options=options,
        expected_provenance_id="tabular-provenance",
    )


def test_tabular_csv_requires_explicit_mapping_and_normalizes_time_unit(
    tmp_path: Path,
) -> None:
    source = tmp_path / "hardware.csv"
    source.write_text("seq,clock,syndrome\n7,100,101\n8,101,000\n", encoding="utf-8")
    chunks = tuple(TabularAdapter().import_batches(source, _mapping()))
    assert all(isinstance(chunk, ImportChunk) for chunk in chunks)
    batches = tuple(chunk.payload for chunk in chunks)
    assert all(isinstance(batch, SyndromeBatch) for batch in batches)
    assert batches[0].sequence_start == 7
    assert batches[0].detector_events.data == b"\x05\x00"
    assert batches[0].source_timestamps.status is ValueStatus.MEASURED
    assert batches[0].source_timestamps.value is not None
    assert batches[0].source_timestamps.value.unit == "ns"
    span = chunks[0].source_spans[0]
    assert span == SourceSpan(
        source_id=span.source_id,
        row_range=IndexRange(1, 3),
        byte_ranges=(
            IndexRange(len("seq,clock,syndrome\n"), len(source.read_bytes())),
        ),
        precision=SourceSpanPrecision.EXACT,
    )


def test_tabular_syndrome_identity_uses_canonical_storage_field_names() -> None:
    mapping = ImportMapping(
        fields=(
            ("sequence", "shot_index"),
            ("detector_events", "syndrome"),
            ("observable_events", "logical"),
            ("timestamp", "clock"),
        ),
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("observable_count", 1),
            ("bit_order", "lsb0"),
            ("timestamp_unit", "us"),
        ),
    )

    identity = _semantic_identity("a" * 64, TabularAdapter(), mapping)

    assert dict(identity.mapping) == {
        "sequence": "shot_index",
        "detectors": "syndrome",
        "observables": "logical",
        "timestamp": "clock",
    }
    assert identity.units == (("timestamp", "us"),)
    nanosecond_mapping = ImportMapping(
        fields=mapping.fields,
        options=tuple(
            (name, "ns" if name == "timestamp_unit" else value)
            for name, value in mapping.options
        ),
    )
    assert _semantic_identity(
        "a" * 64, TabularAdapter(), nanosecond_mapping
    ) != identity


def test_tabular_calibration_identity_includes_qualified_status_columns() -> None:
    fields = (
        ("calibration_id", "cal_id"),
        ("scope_kind", "scope_kind"),
        ("scope_id", "scope_id"),
        ("parameter_name", "name"),
        ("semantic_id", "semantic"),
        ("value", "value"),
        ("value_status", "value_status"),
        ("unit", "unit"),
        ("unit_status", "unit_status"),
        ("uncertainty", "sigma"),
        ("uncertainty_status", "sigma_status"),
        ("quality", "quality"),
        ("source_system", "system"),
        ("effective_start", "effective"),
    )
    mapping = ImportMapping(
        fields=fields,
        options=(("output_kind", "calibration"),),
    )

    identity = _semantic_identity("a" * 64, TabularAdapter(), mapping)

    identity_mapping = dict(identity.mapping)
    assert identity_mapping["value_status"] == "value_status"
    assert identity_mapping["unit_status"] == "unit_status"
    assert identity_mapping["uncertainty_status"] == "sigma_status"


def test_tabular_converts_supported_timestamp_units_losslessly_to_ns(
    tmp_path: Path,
) -> None:
    source = tmp_path / "hardware.csv"
    source.write_text("seq,clock,syndrome\n0,1.5,101\n", encoding="utf-8")
    mapping = ImportMapping(
        fields=(
            ("sequence", "seq"),
            ("detector_events", "syndrome"),
            ("timestamp", "clock"),
        ),
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("bit_order", "lsb0"),
            ("timestamp_unit", "s"),
        ),
    )

    report = TabularAdapter().validate(source, mapping)
    chunk = next(TabularAdapter().import_batches(source, mapping))
    timestamps = chunk.payload.source_timestamps.value

    assert report.valid
    assert timestamps is not None
    assert timestamps.unit == "ns"
    assert timestamps.values == (1_500_000_000,)


@pytest.mark.parametrize(
    ("clock", "unit", "message"),
    (
        ("100.5", "ns", "whole nanoseconds"),
        ("1", "fortnight", "timestamp_unit"),
        (str(2**63), "ns", "signed 64-bit"),
    ),
)
def test_tabular_rejects_timestamps_that_cannot_be_stored_losslessly(
    tmp_path: Path, clock: str, unit: str, message: str
) -> None:
    source = tmp_path / "hardware.csv"
    source.write_text(f"seq,clock,syndrome\n0,{clock},101\n", encoding="utf-8")
    mapping = ImportMapping(
        fields=(
            ("sequence", "seq"),
            ("detector_events", "syndrome"),
            ("timestamp", "clock"),
        ),
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("bit_order", "lsb0"),
            ("timestamp_unit", unit),
        ),
    )

    report = TabularAdapter().validate(source, mapping)

    assert not report.valid
    assert message in report.issues[0].message
    with pytest.raises(ValueError, match=message):
        TabularAdapter().preview(source, mapping, 1)


def test_tabular_rejects_rounds_outside_parquet_uint32_range(tmp_path: Path) -> None:
    source = tmp_path / "hardware.csv"
    source.write_text(f"seq,round,syndrome\n0,{2**32},101\n", encoding="utf-8")
    mapping = ImportMapping(
        fields=(
            ("sequence", "seq"),
            ("detector_events", "syndrome"),
            ("round", "round"),
        ),
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("bit_order", "lsb0"),
        ),
    )

    report = TabularAdapter().validate(source, mapping)

    assert not report.valid
    assert "round must be between 0 and 4294967295" in report.issues[0].message


def test_tabular_ndjson_and_gap_provenance(tmp_path: Path) -> None:
    source = tmp_path / "hardware.ndjson"
    source.write_text(
        "\n".join(
            json.dumps(row)
            for row in (
                {"seq": 1, "clock": 1.0, "syndrome": "001"},
                {"seq": 3, "clock": 2.0, "syndrome": "100"},
            )
        )
        + "\n",
        encoding="utf-8",
    )
    chunks = tuple(TabularAdapter().import_batches(source, _mapping()))
    batches = tuple(chunk.payload for chunk in chunks)
    assert len(batches) == 2
    assert batches[1].data_quality == (DataQualityFlag.GAP_BEFORE,)
    assert (
        chunks[1].source_spans[0].byte_ranges[0].start
        > chunks[0].source_spans[0].byte_ranges[0].start
    )


def test_tabular_never_guesses_units_or_bit_width(tmp_path: Path) -> None:
    source = tmp_path / "hardware.csv"
    source.write_text("seq,clock,syndrome\n0,1,101\n", encoding="utf-8")
    no_mapping = TabularAdapter().validate(source, ImportMapping())
    assert not no_mapping.valid
    assert no_mapping.issues[0].code == "tabular_mapping_required"

    fields = (
        ("sequence", "seq"),
        ("detector_events", "syndrome"),
        ("timestamp", "clock"),
    )
    missing_unit = ImportMapping(
        fields=fields,
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("bit_order", "lsb0"),
        ),
    )
    report = TabularAdapter().validate(source, missing_unit)
    assert not report.valid
    assert report.issues[0].code == "tabular_unit_required"


def test_observable_count_requires_an_observable_events_mapping(tmp_path: Path) -> None:
    source = tmp_path / "hardware.csv"
    source.write_text("seq,syndrome\n0,101\n", encoding="utf-8")
    mapping = ImportMapping(
        fields=(("sequence", "seq"), ("detector_events", "syndrome")),
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("observable_count", 1),
            ("bit_order", "lsb0"),
        ),
    )
    report = TabularAdapter().validate(source, mapping)
    assert not report.valid
    assert report.issues[0].code == "tabular_mapping_invalid"
    assert "observable_count requires observable_events" in report.issues[0].message


def test_tabular_rejects_nonmonotonic_sequence_and_invalid_bits(tmp_path: Path) -> None:
    source = tmp_path / "bad.csv"
    source.write_text("seq,clock,syndrome\n2,1,101\n1,2,10x\n", encoding="utf-8")
    report = TabularAdapter().validate(source, _mapping())
    assert not report.valid
    assert report.issues[0].code == "tabular_invalid_data"


def test_tabular_calibration_mapping_emits_typed_calibration_records(
    tmp_path: Path,
) -> None:
    source = tmp_path / "calibration.csv"
    source.write_text(
        "cal_id,scope_kind,scope_id,name,semantic,value,value_status,unit,unit_status,sigma,sigma_status,quality,system,effective\n"
        "cal-1,qubit,q0,T1,t1,81.2,measured,us,measured,,unavailable,accepted,lab-db,2026-07-21T12:00:00Z\n",
        encoding="utf-8",
    )
    fields = (
        ("calibration_id", "cal_id"),
        ("scope_kind", "scope_kind"),
        ("scope_id", "scope_id"),
        ("parameter_name", "name"),
        ("semantic_id", "semantic"),
        ("value", "value"),
        ("value_status", "value_status"),
        ("unit", "unit"),
        ("unit_status", "unit_status"),
        ("uncertainty", "sigma"),
        ("uncertainty_status", "sigma_status"),
        ("quality", "quality"),
        ("source_system", "system"),
        ("effective_start", "effective"),
    )
    mapping = ImportMapping(
        fields=fields,
        options=(
            ("output_kind", "calibration"),
            ("session_id", "hardware-run"),
        ),
        expected_provenance_id="calibration-provenance",
    )
    chunks = tuple(TabularAdapter().import_batches(source, mapping))
    assert len(chunks) == 1
    assert isinstance(chunks[0].payload, CalibrationBatch)
    record = chunks[0].payload.records[0]
    assert record.scope.kind is CalibrationScopeKind.QUBIT
    assert record.scope.id == "q0"
    assert record.value.value == 81.2
    assert record.unit.value == "us"
    assert record.uncertainty.status is ValueStatus.UNAVAILABLE
    assert record.uncertainty.value is None
    assert record.quality is CalibrationQuality.ACCEPTED
    assert record.original_mime_type == "text/csv"
    assert record.original_representation.startswith("cal-1,qubit,q0")
    assert chunks[0].source_spans[0].row_range == IndexRange(1, 2)


@pytest.mark.parametrize("container_kind", ["arrow-file", "arrow-stream", "parquet"])
def test_arrow_and_parquet_normalize_at_pyarrow_18_floor(
    tmp_path: Path, container_kind: str
) -> None:
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    source = tmp_path / (
        "hardware.parquet" if container_kind == "parquet" else "hardware.arrow"
    )
    table = pa.table(
        {"seq": [7, 8], "clock": [100.0, 101.0], "syndrome": [b"\x05", b"\x00"]}
    )
    if container_kind == "parquet":
        pq.write_table(table, source, write_page_checksum=True)
    else:
        with pa.OSFile(str(source), "wb") as sink:
            writer_factory = (
                pa.ipc.new_file if container_kind == "arrow-file" else pa.ipc.new_stream
            )
            with writer_factory(sink, table.schema) as writer:
                writer.write_table(table)
    chunks = tuple(TabularAdapter().import_batches(source, _mapping()))
    assert (
        b"".join(chunk.payload.detector_events.data for chunk in chunks) == b"\x05\x00"
    )
    assert all(
        chunk.source_spans[0].precision is SourceSpanPrecision.CONTAINER
        for chunk in chunks
    )
    assert chunks[0].source_spans[0].row_range.start == 0


@pytest.mark.parametrize("container_kind", ["arrow-file", "arrow-stream", "parquet"])
def test_arrow_and_parquet_decode_from_a_pathless_capability(
    tmp_path: Path, container_kind: str
) -> None:
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    source = tmp_path / (
        "capability.parquet" if container_kind == "parquet" else "capability.arrow"
    )
    table = pa.table({"seq": [7], "syndrome": [b"\x05"]})
    if container_kind == "parquet":
        pq.write_table(table, source, write_page_checksum=True)
    else:
        with pa.OSFile(str(source), "wb") as sink:
            factory = (
                pa.ipc.new_file if container_kind == "arrow-file" else pa.ipc.new_stream
            )
            with factory(sink, table.schema) as writer:
                writer.write_table(table)

    capability = _PathlessCapability(source)
    chunks = tuple(
        TabularAdapter().import_batches(capability, _mapping(with_time=False))
    )

    assert chunks[0].payload.detector_events.data == b"\x05"


class _PathlessCapability:
    is_capability_source = True

    def __init__(self, source: Path) -> None:
        self._source = source
        self.suffix = source.suffix

    def open(self, mode: str = "rb") -> BinaryIO:
        return self._source.open(mode)

    def stat(self) -> object:
        return self._source.stat()

    def lstat(self) -> object:
        return self._source.lstat()

    def is_file(self) -> bool:
        return True

    def is_dir(self) -> bool:
        return False

    def __fspath__(self) -> str:
        raise AssertionError("capability must not be converted to a pathname")


@pytest.mark.parametrize("container_kind", ["arrow-file", "arrow-stream", "parquet"])
def test_arrow_and_parquet_reject_duplicate_schema_names_before_projection(
    tmp_path: Path, container_kind: str
) -> None:
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    source = tmp_path / (
        "duplicate.parquet" if container_kind == "parquet" else "duplicate.arrow"
    )
    table = pa.Table.from_arrays(
        [pa.array([0]), pa.array([99]), pa.array([b"\x00"])],
        names=["seq", "seq", "syndrome"],
    )
    if container_kind == "parquet":
        pq.write_table(table, source, write_page_checksum=True)
    else:
        with pa.OSFile(str(source), "wb") as sink:
            writer_factory = (
                pa.ipc.new_file if container_kind == "arrow-file" else pa.ipc.new_stream
            )
            with writer_factory(sink, table.schema) as writer:
                writer.write_table(table)

    with pytest.raises(
        ValueError, match="duplicate Arrow schema field.*seq.*ambiguous"
    ):
        tuple(TabularAdapter().import_batches(source, _mapping(with_time=False)))


def test_arrow_container_size_is_rejected_before_memory_mapping(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pa = pytest.importorskip("pyarrow")
    source = tmp_path / "hardware.arrow"
    table = pa.table({"seq": [0], "syndrome": [b"\x00"]})
    with pa.OSFile(str(source), "wb") as sink:
        with pa.ipc.new_file(sink, table.schema) as writer:
            writer.write_table(table)
    monkeypatch.setattr(
        tabular_sources, "MAX_IPC_CONTAINER_BYTES", source.stat().st_size - 1
    )

    def fail_memory_map(*args: object, **kwargs: object) -> object:
        raise AssertionError("oversized IPC input reached memory mapping")

    monkeypatch.setattr(pa, "memory_map", fail_memory_map)
    with pytest.raises(ValueError, match="IPC source exceeds"):
        tuple(TabularAdapter().import_batches(source, _mapping(with_time=False)))


def test_arrow_record_batch_count_is_bounded_from_footer_before_decode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pa = pytest.importorskip("pyarrow")
    source = tmp_path / "many-batches.arrow"
    table = pa.table({"seq": [0, 1], "syndrome": [b"\x00", b"\x00"]})
    with pa.OSFile(str(source), "wb") as sink:
        with pa.ipc.new_file(sink, table.schema) as writer:
            writer.write_table(table, max_chunksize=1)
    monkeypatch.setattr(tabular_sources, "MAX_IPC_RECORD_BATCHES", 1)
    with pytest.raises(ValueError, match="record batch count"):
        tuple(TabularAdapter().import_batches(source, _mapping(with_time=False)))


def test_parquet_row_group_metadata_bounds_materialization(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    source = tmp_path / "large-row-group.parquet"
    table = pa.table({"seq": [0], "syndrome": [b"\x00" * 1024]})
    pq.write_table(table, source, write_page_checksum=True)
    monkeypatch.setattr(tabular_sources, "MAX_DECODE_BATCH_BYTES", 32)
    with pytest.raises(ValueError, match="Parquet row group.*metadata"):
        tuple(TabularAdapter().import_batches(source, _mapping(with_time=False)))


def test_tabular_csv_multiline_record_uses_csv_record_ordinal(tmp_path: Path) -> None:
    source = tmp_path / "multiline.csv"
    source.write_text(
        ' seq ,clock,syndrome,note\n7,100,101,"first\nsecond"\n',
        encoding="utf-8",
    )
    chunk = next(TabularAdapter().import_batches(source, _mapping()))
    assert chunk.source_spans[0].row_range == IndexRange(1, 2)
    assert chunk.source_spans[0].byte_ranges[0].end == len(source.read_bytes())


def test_tabular_rejects_duplicate_json_keys_and_ambiguous_mapping(
    tmp_path: Path,
) -> None:
    source = tmp_path / "duplicate.ndjson"
    source.write_text(
        '{"seq":0,"seq":1,"clock":1,"syndrome":"101"}\n',
        encoding="utf-8",
    )
    assert not TabularAdapter().validate(source, _mapping()).valid

    csv_source = tmp_path / "mapping.csv"
    csv_source.write_text("seq,clock,syndrome\n0,1,101\n", encoding="utf-8")
    ambiguous = ImportMapping(
        fields=(("sequence", "seq"), ("detector_events", "seq")),
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("bit_order", "lsb0"),
            ("invented_option", True),
        ),
    )
    report = TabularAdapter().validate(csv_source, ambiguous)
    assert not report.valid
    assert "unique" in report.issues[0].message

    unsupported = ImportMapping(
        fields=(("sequence", "seq"), ("detector_events", "syndrome")),
        options=(
            ("output_kind", "syndromes"),
            ("detector_count", 3),
            ("bit_order", "lsb0"),
            ("invented_option", True),
        ),
    )
    report = TabularAdapter().validate(csv_source, unsupported)
    assert not report.valid
    assert "unsupported option" in report.issues[0].message


def test_tabular_preview_is_explicitly_bounded(tmp_path: Path) -> None:
    source = tmp_path / "many.ndjson"
    source.write_text(
        "".join(
            json.dumps({"seq": index, "clock": index, "syndrome": "000"}) + "\n"
            for index in range(32)
        ),
        encoding="utf-8",
    )
    preview = TabularAdapter().preview(source, _mapping(), 10_000)
    assert sum(chunk.record_count for chunk in preview.batches) <= 16
    assert preview.truncated


def test_parquet_timestamp_calibration_has_tagged_original_representation(
    tmp_path: Path,
) -> None:
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    source = tmp_path / "calibration.parquet"
    table = pa.table(
        {
            "cal_id": ["cal-1"],
            "scope_kind": ["qubit"],
            "scope_id": ["q0"],
            "name": ["T1"],
            "semantic": ["t1"],
            "value": [81.2],
            "value_status": ["measured"],
            "unit": ["us"],
            "unit_status": ["measured"],
            "sigma": pa.array([None], type=pa.float64()),
            "sigma_status": ["unavailable"],
            "quality": ["accepted"],
            "system": ["lab-db"],
            "operator": ["alice"],
            "effective": pa.array(
                [datetime(2026, 7, 21, 12, tzinfo=timezone.utc)],
                type=pa.timestamp("s", tz="UTC"),
            ),
        }
    )
    pq.write_table(table, source, write_page_checksum=True)
    fields = (
        ("calibration_id", "cal_id"),
        ("scope_kind", "scope_kind"),
        ("scope_id", "scope_id"),
        ("parameter_name", "name"),
        ("semantic_id", "semantic"),
        ("value", "value"),
        ("value_status", "value_status"),
        ("unit", "unit"),
        ("unit_status", "unit_status"),
        ("uncertainty", "sigma"),
        ("uncertainty_status", "sigma_status"),
        ("quality", "quality"),
        ("source_system", "system"),
        ("effective_start", "effective"),
    )
    mapping = ImportMapping(
        fields=fields,
        options=(("output_kind", "calibration"), ("session_id", "hardware-run")),
        expected_provenance_id="calibration-provenance",
    )
    record = next(TabularAdapter().import_batches(source, mapping)).payload.records[0]
    assert record.effective_start == "2026-07-21T12:00:00+00:00"
    assert record.original_mime_type == "application/json"
    assert '"$type":"datetime"' in record.original_representation
    assert '"operator":"alice"' in record.original_representation


class ContractTabularAdapter(TabularAdapter):
    @staticmethod
    def _contract_mapping(mapping: ImportMapping) -> ImportMapping:
        configured = _mapping()
        return ImportMapping(
            fields=configured.fields,
            options=configured.options,
            expected_provenance_id=mapping.expected_provenance_id,
        )

    def validate(self, source: Path, mapping: ImportMapping):
        return super().validate(source, self._contract_mapping(mapping))

    def preview(self, source: Path, mapping: ImportMapping, limit: int):
        return super().preview(source, self._contract_mapping(mapping), limit)

    def import_batches(self, source: Path, mapping: ImportMapping):
        return super().import_batches(source, self._contract_mapping(mapping))


def test_tabular_adapter_passes_typed_contract(tmp_path: Path) -> None:
    source = tmp_path / "hardware.csv"
    source.write_text("seq,clock,syndrome\n0,1,101\n1,2,000\n", encoding="utf-8")
    report = run_adapter_contract(
        ContractTabularAdapter,
        source,
        isolation_backend=trusted_process_group_backend(),
    )
    assert report.passed, report.failures


def test_core_offline_registry_is_fresh_complete_and_resolvable() -> None:
    first = core_offline_registry()
    second = core_offline_registry()
    assert first is not second
    assert tuple(record.key for record in first.registrations) == (
        ("stim-results", "1"),
        ("sinter-csv", "1"),
        ("tabular", "1"),
    )
    assert isinstance(first.get("stim-results", "1"), StimResultsAdapter)
    assert isinstance(first.get("sinter-csv", "1"), SinterCsvAdapter)
    assert isinstance(first.get("tabular", "1"), TabularAdapter)
