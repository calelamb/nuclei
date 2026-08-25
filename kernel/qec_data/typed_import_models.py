"""Canonical aggregate and calibration payloads for typed import chunks."""

from __future__ import annotations

from dataclasses import dataclass

from .json_document import (
    parse_canonical_json_document,
    validate_canonical_json_document,
)
from .model_validation import (
    SCHEMA_VERSION,
    require_exact_int,
    require_finite,
    require_immutable_tuple,
    require_non_empty,
)

MAX_TYPED_BATCH_RECORDS = 65_536


def _validate_record_batch(
    batch: object, records: tuple[object, ...], record_type: type
) -> None:
    for name in ("batch_id", "session_id", "segment_id", "provenance_id"):
        require_non_empty(name, getattr(batch, name))
    require_exact_int("record_count", getattr(batch, "record_count"), minimum=1)
    require_exact_int("sequence_start", getattr(batch, "sequence_start"))
    require_exact_int("sequence_end", getattr(batch, "sequence_end"), minimum=1)
    sequence_size = getattr(batch, "sequence_end") - getattr(batch, "sequence_start")
    if sequence_size != getattr(batch, "record_count"):
        raise ValueError("sequence range must equal record_count")
    require_immutable_tuple("records", records)
    if any(type(record) is not record_type for record in records):
        raise TypeError(f"records must contain only {record_type.__name__}")
    if len(records) != getattr(batch, "record_count"):
        raise ValueError("records length must equal record_count")
    if getattr(batch, "record_count") > MAX_TYPED_BATCH_RECORDS:
        raise ValueError("typed batches may contain at most 65,536 records")
    if getattr(batch, "schema_version") != SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SCHEMA_VERSION}")


@dataclass(frozen=True, slots=True)
class CampaignPointRecord:
    """One aggregate sinter campaign point, never a synthetic shot record."""

    shots: int
    errors: int
    discards: int
    seconds: float
    decoder: str
    strong_id: str
    json_metadata: str
    custom_counts: str

    def __post_init__(self) -> None:
        for name in ("shots", "errors", "discards"):
            require_exact_int(name, getattr(self, name))
        if self.errors + self.discards > self.shots:
            raise ValueError("errors and discards cannot exceed shots")
        require_finite("seconds", self.seconds)
        if self.seconds < 0:
            raise ValueError("seconds cannot be negative")
        require_non_empty("decoder", self.decoder)
        require_non_empty("strong_id", self.strong_id)
        validate_canonical_json_document("json_metadata", self.json_metadata)
        try:
            custom_counts = parse_canonical_json_document(
                "custom_counts", self.custom_counts
            )
        except (TypeError, ValueError) as error:
            raise ValueError(f"custom_counts is invalid: {error}") from error
        if not isinstance(custom_counts, dict) or any(
            type(value) is not int or value < 0 for value in custom_counts.values()
        ):
            raise ValueError(
                "custom_counts must be an object of nonnegative exact integers"
            )


@dataclass(frozen=True, slots=True)
class CampaignPointBatch:
    batch_id: str
    session_id: str
    segment_id: str
    sequence_start: int
    sequence_end: int
    record_count: int
    records: tuple[CampaignPointRecord, ...]
    provenance_id: str
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        _validate_record_batch(self, self.records, CampaignPointRecord)

    @property
    def record_kind(self) -> str:
        return "campaign_points"


@dataclass(frozen=True, slots=True)
class CalibrationBatch:
    batch_id: str
    session_id: str
    segment_id: str
    sequence_start: int
    sequence_end: int
    record_count: int
    records: tuple[CalibrationRecord, ...]
    provenance_id: str
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        _validate_record_batch(self, self.records, CalibrationRecord)
        for record in self.records:
            if record.session_id != self.session_id:
                raise ValueError("calibration record session_id must match its batch")
            if record.provenance_id != self.provenance_id:
                raise ValueError(
                    "calibration record provenance_id must match its batch"
                )

    @property
    def record_kind(self) -> str:
        return "calibrations"


from .models import CalibrationRecord  # noqa: E402
