import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

from kernel.qec_data.model_codecs import (
    batch_from_mapping,
    batch_to_mapping,
    decode_from_mapping,
    decode_to_mapping,
    loads_canonical_json,
    session_from_mapping,
    session_to_mapping,
)
from kernel.qec_data.models import (
    AdapterIdentity,
    CalibrationRecord,
    CalibrationScope,
    CalibrationScopeKind,
    DecodeRecord,
    DecodeStatus,
    QualifiedCorrection,
    CorrectionValue,
    DataQualityFlag,
    DecodeError,
    PackedBits,
    ProvenanceRecord,
    ProvenanceOperation,
    ProvenanceSource,
    QualifiedFloat,
    QualifiedPackedBits,
    QualifiedRange,
    QualifiedText,
    QualifiedTimestamps,
    SessionCounts,
    SessionKind,
    SessionRecord,
    SessionReferences,
    SessionStatus,
    SourceClock,
    SyndromeBatch,
    Timebase,
    UNKNOWN_BITS,
    UNKNOWN_COUNT,
    UNKNOWN_TEXT,
    SourcePolicy,
    ValueStatus,
)


FIXTURES = Path(__file__).parents[3] / "schemas" / "qec-data" / "v1" / "fixtures"


def load_fixture(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_session_record_is_frozen_and_uses_immutable_segments() -> None:
    session = SessionRecord.minimal(
        "s1", SessionKind.HARDWARE_IMPORT, "generic.parquet", "1.0.0", "p1"
    )
    assert session.segments == ()
    with pytest.raises(FrozenInstanceError):
        session.status = SessionStatus.FAILED  # type: ignore[misc]


def test_session_minimal_rejects_blank_boundary_identifiers() -> None:
    with pytest.raises(ValueError, match="session_id"):
        SessionRecord.minimal(
            " ", SessionKind.HARDWARE_IMPORT, "generic.parquet", "1.0.0", "p1"
        )


def test_packed_bits_rejects_mutable_or_incorrectly_sized_buffers() -> None:
    with pytest.raises(TypeError, match="bytes"):
        PackedBits(bit_width=2, data=bytearray(b"\x00"))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="size"):
        PackedBits(bit_width=9, data=b"\x00")


def test_syndrome_batch_validates_sequence_and_packed_detector_width() -> None:
    batch = SyndromeBatch(
        batch_id="batch-1",
        session_id="session-1",
        segment_id="segment-1",
        sequence_start=10,
        sequence_end=12,
        record_count=2,
        detector_events=PackedBits(bit_width=9, data=b"\x00\x00\x00\x00"),
        provenance_id="p1",
    )
    assert batch.detector_events.data == bytes(4)
    with pytest.raises(ValueError, match="sequence range"):
        SyndromeBatch(
            batch_id="bad",
            session_id="session-1",
            segment_id="segment-1",
            sequence_start=10,
            sequence_end=11,
            record_count=2,
            detector_events=PackedBits(bit_width=9, data=bytes(4)),
            provenance_id="p1",
        )


def test_syndrome_batch_validates_optional_observable_width() -> None:
    with pytest.raises(ValueError, match="observables"):
        SyndromeBatch(
            batch_id="bad",
            session_id="session-1",
            segment_id="segment-1",
            sequence_start=0,
            sequence_end=2,
            record_count=2,
            detector_events=PackedBits(bit_width=1, data=bytes(2)),
            provenance_id="p1",
            observables=QualifiedPackedBits(
                value=PackedBits(bit_width=9, data=bytes(2)),
                status=ValueStatus.MEASURED,
            ),
        )


def test_qualified_values_reject_ambiguous_value_status_pairs() -> None:
    with pytest.raises(ValueError, match="measured"):
        QualifiedFloat(value=None, status=ValueStatus.MEASURED)
    with pytest.raises(ValueError, match="absent"):
        QualifiedText(value="Hz", status=ValueStatus.ABSENT)


def test_decode_calibration_and_provenance_models_are_frozen() -> None:
    decode = DecodeRecord.minimal(
        decode_id="decode-1",
        session_id="session-1",
        batch_id="batch-1",
        decoder=AdapterIdentity("pymatching", "2.3.1"),
        configuration_sha256="a" * 64,
        prediction=PackedBits(1, b"\x00"),
        predicted_logical_flips=PackedBits(1, b"\x00"),
        provenance_id="p1",
    )
    assert decode.status is DecodeStatus.COMPLETE
    calibration = CalibrationRecord.minimal(
        calibration_id="cal-1",
        session_id="session-1",
        scope=CalibrationScope(kind=CalibrationScopeKind.QUBIT, id="q0"),
        parameter_name="readout assignment error",
        semantic_id="vendor.example/readout_assignment_error",
        source_system="lab-db",
        provenance_id="p1",
    )
    assert calibration.value.status is ValueStatus.UNKNOWN
    provenance = ProvenanceRecord(
        provenance_id="p1",
        created_at="2026-07-21T00:00:00Z",
        adapter=AdapterIdentity("generic", "1.0.0"),
        sources=(
            ProvenanceSource(
                "source-1", "capture.dets", "b" * 64, SourcePolicy.REFERENCE
            ),
        ),
    )
    with pytest.raises(FrozenInstanceError):
        provenance.provenance_id = "p2"  # type: ignore[misc]


def test_session_and_batch_fixtures_round_trip_without_shape_loss() -> None:
    session_mapping = load_fixture("minimal-session.json")
    batch_mapping = load_fixture("minimal-batch.json")
    assert session_to_mapping(session_from_mapping(session_mapping)) == session_mapping
    assert batch_to_mapping(batch_from_mapping(batch_mapping)) == batch_mapping


@pytest.mark.parametrize(
    "model_name", ["session", "batch", "decode", "calibration", "provenance"]
)
def test_every_record_rejects_an_incompatible_schema_version(model_name: str) -> None:
    session = session_from_mapping(load_fixture("minimal-session.json"))
    batch = batch_from_mapping(load_fixture("minimal-batch.json"))
    decode = DecodeRecord.minimal(
        decode_id="d1",
        session_id="s1",
        batch_id="b1",
        decoder=AdapterIdentity("decoder", "1"),
        configuration_sha256="a" * 64,
        prediction=PackedBits(1, b"\x00"),
        predicted_logical_flips=PackedBits(1, b"\x00"),
        provenance_id="p1",
    )
    calibration = CalibrationRecord.minimal(
        calibration_id="c1",
        session_id="s1",
        scope=CalibrationScope(CalibrationScopeKind.DEVICE, "device-1"),
        parameter_name="parameter",
        semantic_id="vendor/parameter",
        source_system="source",
        provenance_id="p1",
    )
    provenance = ProvenanceRecord(
        "p1",
        "2026-07-21T00:00:00Z",
        AdapterIdentity("adapter", "1"),
        sources=(
            ProvenanceSource("source", "capture", "b" * 64, SourcePolicy.REFERENCE),
        ),
    )
    records = {
        "session": session,
        "batch": batch,
        "decode": decode,
        "calibration": calibration,
        "provenance": provenance,
    }
    with pytest.raises(ValueError, match="schema_version"):
        replace(records[model_name], schema_version="2.0.0")


def test_provenance_requires_at_least_one_original_source() -> None:
    with pytest.raises(ValueError, match="source"):
        ProvenanceRecord("p1", "2026-07-21T00:00:00Z", AdapterIdentity("adapter", "1"))


def test_tuple_collections_reject_mutable_list_inputs() -> None:
    session = SessionRecord.minimal(
        "s1", SessionKind.HARDWARE_IMPORT, "adapter", "1", "p1"
    )
    with pytest.raises(TypeError, match="segments"):
        replace(session, segments=["segment-1"])  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="sources"):
        ProvenanceRecord(
            "p1",
            "2026-07-21T00:00:00Z",
            AdapterIdentity("adapter", "1"),
            sources=[  # type: ignore[arg-type]
                ProvenanceSource("s1", "capture", "b" * 64, SourcePolicy.REFERENCE)
            ],
        )


def test_syndrome_batch_never_invents_a_provenance_reference() -> None:
    with pytest.raises(TypeError, match="provenance_id"):
        SyndromeBatch(
            batch_id="batch-1",
            session_id="session-1",
            segment_id="segment-1",
            sequence_start=0,
            sequence_end=1,
            record_count=1,
            detector_events=PackedBits(1, b"\x00"),
        )  # type: ignore[call-arg]


def test_provenance_operations_preserve_immutable_canonical_parameters() -> None:
    operation = ProvenanceOperation(
        "threshold-fit", "1.0.0", (("min_distance", 3), ("robust", True))
    )
    assert operation.parameters[0] == ("min_distance", 3)
    with pytest.raises(TypeError, match="parameters"):
        ProvenanceOperation("threshold-fit", "1.0.0", {"min_distance": 3})  # type: ignore[arg-type]


def test_packed_bits_enforce_lsb0_zero_padding_and_safe_types() -> None:
    with pytest.raises(TypeError, match="bit_width"):
        PackedBits(True, b"\x00")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="padding"):
        PackedBits(9, b"\x00\x02")
    with pytest.raises(ValueError, match="finite"):
        QualifiedFloat(float("nan"), ValueStatus.MEASURED)


def test_python_models_reject_string_enums_and_non_rfc3339_timestamps() -> None:
    with pytest.raises(TypeError, match="kind"):
        SessionRecord.minimal("s1", "hardware_import", "adapter", "1", "p1")  # type: ignore[arg-type]
    session = SessionRecord.minimal(
        "s1", SessionKind.HARDWARE_IMPORT, "adapter", "1", "p1"
    )
    with pytest.raises(ValueError, match="RFC 3339"):
        replace(session, created_at="not-a-date")
    with pytest.raises(TypeError, match="status"):
        QualifiedText(None, "unknown")  # type: ignore[arg-type]


def test_batch_quality_and_timestamp_invariants() -> None:
    batch = batch_from_mapping(load_fixture("minimal-batch.json"))
    with pytest.raises(ValueError, match="data_quality"):
        replace(batch, data_quality=())
    with pytest.raises(ValueError, match="complete"):
        replace(batch, data_quality=(batch.data_quality[0], DataQualityFlag.PARTIAL))
    invalid = load_fixture("minimal-batch.json")
    invalid["source_timestamps"] = {
        "value": {"values": [1.0, 2.0], "unit": "ns"},
        "status": "measured",
    }
    with pytest.raises(ValueError, match="record_count"):
        batch_from_mapping(invalid)


def test_session_lifecycle_matrix() -> None:
    session = session_from_mapping(load_fixture("minimal-session.json"))
    with pytest.raises(ValueError, match="complete"):
        replace(session, status=SessionStatus.COMPLETE)


def test_decode_fixture_round_trips_with_tagged_correction() -> None:
    mapping = load_fixture("minimal-decode-result.json")
    decode = decode_from_mapping(mapping)
    assert decode_to_mapping(decode) == mapping
    correction = QualifiedCorrection(
        CorrectionValue.edges(("edge-1", "edge-2")), ValueStatus.PREDICTED
    )
    assert correction.value is not None
    with pytest.raises(ValueError, match="unique"):
        CorrectionValue.edges(("edge-1", "edge-1"))


def test_decode_status_error_and_exclusive_range_invariants() -> None:
    decode = decode_from_mapping(load_fixture("minimal-decode-result.json"))
    with pytest.raises(ValueError, match="error"):
        replace(decode, status=DecodeStatus.ERROR, error=None)
    with pytest.raises(ValueError, match="error"):
        replace(
            decode,
            status=DecodeStatus.COMPLETE,
            error=DecodeError("unexpected", "success cannot carry errors"),
        )
    with pytest.raises(ValueError, match="sequence"):
        replace(decode, input=replace(decode.input, sequence_start=2, sequence_end=2))


def test_calibration_and_provenance_nested_boundaries_are_strict() -> None:
    calibration = CalibrationRecord.minimal(
        calibration_id="cal-1",
        session_id="s1",
        scope=CalibrationScope(CalibrationScopeKind.DEVICE, "d1"),
        parameter_name="parameter",
        semantic_id="vendor/parameter",
        source_system="source",
        provenance_id="p1",
    )
    with pytest.raises(ValueError, match="MIME"):
        replace(calibration, original_mime_type="blank")
    with pytest.raises(ValueError, match="calibration_run_id"):
        replace(calibration, calibration_run_id=" ")
    provenance = ProvenanceRecord(
        "p1",
        "2026-07-21T00:00:00Z",
        AdapterIdentity("adapter", "1"),
        sources=(
            ProvenanceSource("source", "capture", "b" * 64, SourcePolicy.REFERENCE),
        ),
        parent_dataset_ids=("dataset-1",),
    )
    with pytest.raises(ValueError, match="parent_dataset_ids"):
        replace(provenance, parent_dataset_ids=("dataset-1", "dataset-1"))
    with pytest.raises(TypeError, match="sources"):
        replace(provenance, sources=("not-a-source",))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("constructor", "value"),
    [
        (QualifiedPackedBits, QualifiedText(None, ValueStatus.ABSENT)),
        (QualifiedRange, QualifiedText(None, ValueStatus.ABSENT)),
        (QualifiedTimestamps, QualifiedText(None, ValueStatus.ABSENT)),
    ],
)
def test_qualified_records_reject_wrong_nested_types(constructor, value) -> None:
    with pytest.raises(TypeError):
        constructor(value, ValueStatus.MEASURED)


@pytest.mark.parametrize(
    ("constructor", "field"),
    [
        (lambda: SessionReferences(circuit=UNKNOWN_COUNT), "circuit"),
        (
            lambda: SessionReferences(detector_error_model=UNKNOWN_COUNT),
            "detector_error_model",
        ),
        (lambda: SessionReferences(topology=UNKNOWN_COUNT), "topology"),
        (lambda: SessionReferences(calibration=UNKNOWN_COUNT), "calibration"),
        (lambda: SessionCounts(detectors=UNKNOWN_TEXT), "detectors"),
        (lambda: SessionCounts(observables=UNKNOWN_TEXT), "observables"),
        (lambda: SessionCounts(measurements=UNKNOWN_TEXT), "measurements"),
        (lambda: SessionCounts(logical_patches=UNKNOWN_TEXT), "logical_patches"),
        (lambda: SourceClock(identity=UNKNOWN_COUNT), "identity"),
        (lambda: SourceClock(description=1), "description"),
        (lambda: Timebase(domain=1), "domain"),
        (lambda: Timebase(unit=UNKNOWN_COUNT), "unit"),
        (lambda: Timebase(tick_period=UNKNOWN_COUNT), "tick_period"),
        (lambda: Timebase(description=1), "description"),
    ],
)
def test_session_nested_records_reject_every_wrong_field_type(
    constructor, field
) -> None:
    with pytest.raises(TypeError, match=field):
        constructor()


@pytest.mark.parametrize(
    ("field", "wrong_value"),
    [
        ("detector_events", UNKNOWN_TEXT),
        ("shot_range", UNKNOWN_TEXT),
        ("round_range", UNKNOWN_TEXT),
        ("source_timestamps", UNKNOWN_TEXT),
        ("measurements", UNKNOWN_TEXT),
        ("observables", UNKNOWN_TEXT),
        ("erasures", UNKNOWN_TEXT),
        ("leakage", UNKNOWN_TEXT),
        ("heralds", UNKNOWN_TEXT),
        ("circuit_revision", UNKNOWN_BITS),
        ("topology_revision", UNKNOWN_BITS),
    ],
)
def test_syndrome_rejects_field_specific_type_substitution(field, wrong_value) -> None:
    batch = batch_from_mapping(load_fixture("minimal-batch.json"))
    with pytest.raises(TypeError, match=field):
        replace(batch, **{field: wrong_value})


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("mapping_decisions", (("field", "", "reason"),), "mapping_decisions"),
        ("revision_references", (("kind", ""),), "revision_references"),
        ("annotations", (("kind", ""),), "annotations"),
        ("dependencies", (("package", ""),), "dependencies"),
        (
            "dependencies",
            (("package", "1.0"), ("package", "2.0")),
            "dependencies",
        ),
    ],
)
def test_provenance_validates_every_tuple_position(field, value, message) -> None:
    provenance = ProvenanceRecord(
        "p1",
        "2026-07-21T00:00:00Z",
        AdapterIdentity("adapter", "1"),
        sources=(
            ProvenanceSource("source", "capture", "b" * 64, SourcePolicy.REFERENCE),
        ),
    )
    with pytest.raises(ValueError, match=message):
        replace(provenance, **{field: value})


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_canonical_json_parser_rejects_non_finite_constants(constant: str) -> None:
    with pytest.raises(ValueError, match="non-finite"):
        loads_canonical_json(f'{{"value":{constant}}}')


@pytest.mark.parametrize("number", ["1e309", "-1e309", "1e999", "-1e999"])
def test_canonical_json_parser_rejects_overflowed_numbers(number: str) -> None:
    with pytest.raises(ValueError, match="non-finite"):
        loads_canonical_json(f'{{"value":{number}}}')


def test_canonical_json_parser_rejects_duplicate_keys() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        loads_canonical_json('{"value":1,"value":2}')


def test_calibration_interval_is_ordered() -> None:
    calibration = CalibrationRecord.minimal(
        calibration_id="cal-1",
        session_id="s1",
        scope=CalibrationScope(CalibrationScopeKind.DEVICE, "d1"),
        parameter_name="parameter",
        semantic_id="vendor/parameter",
        source_system="source",
        provenance_id="p1",
    )
    with pytest.raises(ValueError, match="precede"):
        replace(
            calibration,
            effective_start="2026-07-22T00:00:00Z",
            effective_end="2026-07-21T00:00:00Z",
        )
