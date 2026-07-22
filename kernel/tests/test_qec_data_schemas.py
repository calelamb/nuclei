import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator, ValidationError


SCHEMA_ROOT = Path(__file__).parents[2] / "schemas" / "qec-data" / "v1"


def load_json(relative_path: str) -> Any:
    return json.loads((SCHEMA_ROOT / relative_path).read_text(encoding="utf-8"))


def validator(name: str) -> Draft202012Validator:
    schema = load_json(f"{name}.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


@pytest.mark.parametrize(
    "name",
    [
        "session",
        "syndrome-batch",
        "decode-result",
        "calibration-record",
        "provenance",
    ],
)
def test_canonical_schema_is_valid_draft_2020_12(name: str) -> None:
    schema = load_json(f"{name}.schema.json")
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["$id"].endswith(f"/qec-data/v1/{name}.schema.json")
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize(
    ("schema_name", "fixture_name"),
    [("session", "minimal-session"), ("syndrome-batch", "minimal-batch")],
)
def test_shared_fixture_matches_schema(schema_name: str, fixture_name: str) -> None:
    validator(schema_name).validate(load_json(f"fixtures/{fixture_name}.json"))


def test_session_rejects_unknown_fields_and_missing_provenance() -> None:
    session = load_json("fixtures/minimal-session.json")
    with pytest.raises(ValidationError):
        validator("session").validate({**session, "unexpected": True})
    without_provenance = {
        key: value for key, value in session.items() if key != "provenance_id"
    }
    with pytest.raises(ValidationError):
        validator("session").validate(without_provenance)


def test_session_rejects_invalid_lifecycle_and_ambiguous_scientific_values() -> None:
    session = load_json("fixtures/minimal-session.json")
    with pytest.raises(ValidationError):
        validator("session").validate({**session, "status": "ready"})
    ambiguous_counts = {
        **session,
        "counts": {**session["counts"], "detectors": {"value": None}},
    }
    with pytest.raises(ValidationError):
        validator("session").validate(ambiguous_counts)


def test_batch_rejects_negative_or_inconsistent_sequence_ranges() -> None:
    batch = load_json("fixtures/minimal-batch.json")
    with pytest.raises(ValidationError):
        validator("syndrome-batch").validate({**batch, "sequence_start": -1})
    with pytest.raises(ValidationError):
        validator("syndrome-batch").validate({**batch, "sequence_end": 0})


def test_batch_requires_status_for_optional_scientific_fields() -> None:
    batch = load_json("fixtures/minimal-batch.json")
    ambiguous_observables = {
        **batch,
        "observables": {"value": None},
    }
    with pytest.raises(ValidationError):
        validator("syndrome-batch").validate(ambiguous_observables)


def test_decode_calibration_and_provenance_examples_are_valid() -> None:
    validator("decode-result").validate(
        {
            "schema_version": "1.0.0",
            "decode_id": "decode-1",
            "session_id": "session-1",
            "input": {"batch_id": "batch-1", "sequence_start": 0, "sequence_end": 1},
            "decoder": {
                "name": "pymatching",
                "version": "2.3.1",
                "configuration_sha256": "a" * 64,
            },
            "status": "complete",
            "prediction": {"encoding": "base64", "bit_width": 1, "data": "AA=="},
            "confidence": {"value": None, "status": "unavailable"},
            "correction": {"value": None, "status": "unavailable"},
            "predicted_logical_flips": {
                "encoding": "base64",
                "bit_width": 1,
                "data": "AA==",
            },
            "known_truth": {"value": None, "status": "unknown"},
            "pipeline_latency": {"value": None, "unit": None, "status": "unavailable"},
            "total_latency": {"value": None, "unit": None, "status": "unavailable"},
            "error": None,
            "provenance_id": "provenance-1",
        }
    )
    validator("calibration-record").validate(
        {
            "schema_version": "1.0.0",
            "calibration_id": "cal-1",
            "session_id": "session-1",
            "effective_interval": {"start": "2026-07-21T00:00:00Z", "end": None},
            "scope": {"kind": "qubit", "id": "q0"},
            "parameter": {
                "name": "readout assignment error",
                "semantic_id": "vendor.example/readout_assignment_error",
            },
            "value": {"value": 0.012, "status": "measured"},
            "unit": {"value": "1", "status": "measured"},
            "uncertainty": {"value": None, "status": "unavailable"},
            "quality": "accepted",
            "source_system": "lab-calibration-db",
            "calibration_run_id": "run-42",
            "original_representation": {
                "mime_type": "application/json",
                "value": '{"assignment_error":0.012}',
            },
            "provenance_id": "provenance-1",
        }
    )
    validator("provenance").validate(
        {
            "schema_version": "1.0.0",
            "provenance_id": "provenance-1",
            "created_at": "2026-07-21T00:00:00Z",
            "sources": [
                {
                    "source_id": "capture",
                    "uri": "capture.dets",
                    "sha256": "b" * 64,
                    "policy": "reference",
                }
            ],
            "adapter": {"id": "stim.dets", "version": "1.0.0"},
            "mapping_decisions": [],
            "unit_conversions": [],
            "revision_references": [],
            "environment": {
                "runtime": "python",
                "runtime_version": "3.12",
                "dependencies": {},
            },
            "parent_dataset_ids": [],
            "transformations": [],
            "filters": [],
            "exclusions": [],
            "recipes": [],
            "annotations": [],
            "control_audit_refs": [],
        }
    )


def test_provenance_rejects_non_sha256_source_hashes() -> None:
    provenance = {
        "schema_version": "1.0.0",
        "provenance_id": "p1",
        "created_at": "2026-07-21T00:00:00Z",
        "sources": [
            {
                "source_id": "s1",
                "uri": "source",
                "sha256": "not-a-hash",
                "policy": "copy",
            }
        ],
        "adapter": {"id": "generic", "version": "1.0.0"},
        "mapping_decisions": [],
        "unit_conversions": [],
        "revision_references": [],
        "environment": {
            "runtime": "python",
            "runtime_version": "3.12",
            "dependencies": {},
        },
        "parent_dataset_ids": [],
        "transformations": [],
        "filters": [],
        "exclusions": [],
        "recipes": [],
        "annotations": [],
        "control_audit_refs": [],
    }
    with pytest.raises(ValidationError):
        validator("provenance").validate(provenance)
