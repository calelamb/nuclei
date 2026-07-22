import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, ValidationError
from referencing import Registry, Resource


SCHEMA_ROOT = Path(__file__).parents[2] / "schemas" / "qec-data" / "v1"


def _load(name: str) -> object:
    return json.loads((SCHEMA_ROOT / name).read_text(encoding="utf-8"))


def _validator(name: str) -> Draft202012Validator:
    schemas = tuple(_load(path.name) for path in SCHEMA_ROOT.glob("*.schema.json"))
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas
    )
    return Draft202012Validator(_load(name), registry=registry)


@pytest.mark.parametrize(
    "name",
    (
        "campaign-point-batch.schema.json",
        "calibration-batch.schema.json",
        "source-span.schema.json",
        "import-chunk.schema.json",
    ),
)
def test_typed_import_schema_is_strict_draft_2020_12(name: str) -> None:
    schema = _load(name)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize(
    ("schema", "fixture"),
    (
        (
            "campaign-point-batch.schema.json",
            "fixtures/minimal-campaign-point-batch.json",
        ),
        ("calibration-batch.schema.json", "fixtures/minimal-calibration-batch.json"),
        ("import-chunk.schema.json", "fixtures/minimal-import-chunk.json"),
    ),
)
def test_typed_import_fixture_matches_schema(schema: str, fixture: str) -> None:
    _validator(schema).validate(_load(fixture))


def test_import_chunk_schema_rejects_unrecognized_kind() -> None:
    fixture = _load("fixtures/minimal-import-chunk.json")
    with pytest.raises(ValidationError):
        _validator("import-chunk.schema.json").validate(
            {**fixture, "record_kind": "shot_like_aggregate"}
        )


def test_lineage_arrays_are_bounded_by_schema() -> None:
    span = {
        "source_id": "capture",
        "row_range": None,
        "byte_ranges": [{"start": 0, "end": 1}] * 1_025,
        "precision": "container",
    }
    with pytest.raises(ValidationError):
        _validator("source-span.schema.json").validate(span)
    chunk = _load("fixtures/minimal-import-chunk.json")
    with pytest.raises(ValidationError):
        _validator("import-chunk.schema.json").validate(
            {**chunk, "source_spans": [chunk["source_spans"][0]] * 1_025}
        )


def test_campaign_json_documents_have_schema_length_caps() -> None:
    batch = _load("fixtures/minimal-campaign-point-batch.json")
    record = batch["records"][0]
    for field in ("json_metadata", "custom_counts"):
        invalid = {
            **batch,
            "records": [{**record, field: "x" * 65_537}],
        }
        with pytest.raises(ValidationError):
            _validator("campaign-point-batch.schema.json").validate(invalid)
