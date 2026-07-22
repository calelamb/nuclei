"""Private validation primitives and enums for canonical QEC records."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
import math
import re
from typing import Any


SCHEMA_VERSION = "1.0.0"
SHA256_LENGTH = 64
MAX_SAFE_INTEGER = 9_007_199_254_740_991
RFC3339_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)
MIME_PATTERN = re.compile(r"^[^\s/]+/[^\s/]+$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ValueStatus(StrEnum):
    ABSENT = "absent"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"
    INFERRED = "inferred"
    PREDICTED = "predicted"
    SIMULATED = "simulated"
    MEASURED = "measured"


class SessionKind(StrEnum):
    SIMULATION_CAMPAIGN = "simulation_campaign"
    HARDWARE_IMPORT = "hardware_import"
    HARDWARE_LIVE = "hardware_live"
    REPLAY = "replay"


class SessionStatus(StrEnum):
    CREATED = "created"
    IMPORTING = "importing"
    RECORDING = "recording"
    COMPLETE = "complete"
    PARTIAL = "partial"
    FAILED = "failed"


class DecodeStatus(StrEnum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    TIMEOUT = "timeout"
    ERROR = "error"


class DataQualityFlag(StrEnum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    OUT_OF_ORDER = "out_of_order"
    DUPLICATE = "duplicate"
    GAP_BEFORE = "gap_before"
    CLOCK_UNRELIABLE = "clock_unreliable"
    VENDOR_FLAGGED = "vendor_flagged"


class CalibrationScopeKind(StrEnum):
    DEVICE = "device"
    PATCH = "patch"
    QUBIT = "qubit"
    COUPLER = "coupler"
    RESONATOR = "resonator"
    READOUT_CHANNEL = "readout_channel"
    CUSTOM = "custom"


class CalibrationQuality(StrEnum):
    ACCEPTED = "accepted"
    SUSPECT = "suspect"
    REJECTED = "rejected"
    UNKNOWN = "unknown"


class SourcePolicy(StrEnum):
    COPY = "copy"
    REFERENCE = "reference"


class CorrectionKind(StrEnum):
    EDGE_IDS = "edge_ids"
    COMPACT_REF = "compact_ref"


NULL_STATUSES = frozenset(
    {ValueStatus.ABSENT, ValueStatus.UNAVAILABLE, ValueStatus.UNKNOWN}
)


def require_non_empty(name: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def require_enum(name: str, value: object, enum_type: type[StrEnum]) -> None:
    if type(value) is not enum_type:
        raise TypeError(f"{name} must be a {enum_type.__name__}")


def require_exact_int(name: str, value: object, minimum: int = 0) -> None:
    if type(value) is not int:
        raise TypeError(f"{name} must be an integer")
    if not minimum <= value <= MAX_SAFE_INTEGER:
        raise ValueError(f"{name} must be between {minimum} and {MAX_SAFE_INTEGER}")


def require_finite(name: str, value: object) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number")
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite")


def require_rfc3339(name: str, value: str) -> None:
    require_non_empty(name, value)
    if not RFC3339_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be RFC 3339")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{name} must be RFC 3339") from error


def validate_qualified(name: str, value: object | None, status: ValueStatus) -> None:
    require_enum(f"{name} status", status, ValueStatus)
    if status in NULL_STATUSES and value is not None:
        raise ValueError(f"{name} must be null when status is {status.value}")
    if status not in NULL_STATUSES and value is None:
        raise ValueError(f"{name} must have a value when status is {status.value}")


def validate_sha256(name: str, value: str) -> None:
    if len(value) != SHA256_LENGTH or any(
        char not in "0123456789abcdef" for char in value
    ):
        raise ValueError(f"{name} must be a lowercase SHA-256 hex digest")


def _contains_mutable(value: object) -> bool:
    if isinstance(value, (list, dict, set, bytearray)):
        return True
    return isinstance(value, tuple) and any(_contains_mutable(item) for item in value)


def require_immutable_tuple(name: str, value: object) -> None:
    if not isinstance(value, tuple) or _contains_mutable(value):
        raise TypeError(f"{name} must be an immutable tuple")


def _validate_syndrome_types(batch: Any) -> None:
    from .models import (
        PackedBits,
        QualifiedPackedBits,
        QualifiedRange,
        QualifiedText,
        QualifiedTimestamps,
    )

    if type(batch.detector_events) is not PackedBits:
        raise TypeError("detector_events must be PackedBits")
    qualified = (
        batch.shot_range,
        batch.round_range,
        batch.source_timestamps,
        batch.measurements,
        batch.observables,
        batch.erasures,
        batch.leakage,
        batch.heralds,
        batch.circuit_revision,
        batch.topology_revision,
    )
    allowed = (QualifiedRange, QualifiedTimestamps, QualifiedPackedBits, QualifiedText)
    if any(type(value) not in allowed for value in qualified):
        raise TypeError("syndrome qualified fields have invalid types")
    require_immutable_tuple("data_quality", batch.data_quality)
    if any(type(flag) is not DataQualityFlag for flag in batch.data_quality):
        raise TypeError("data_quality values must be DataQualityFlag")
    if not batch.data_quality:
        raise ValueError("data_quality must be nonempty")
    if DataQualityFlag.COMPLETE in batch.data_quality and len(batch.data_quality) != 1:
        raise ValueError("complete data_quality must be exclusive")


def validate_syndrome_batch(batch: Any) -> None:
    _validate_syndrome_types(batch)
    for name in ("batch_id", "session_id", "segment_id", "provenance_id"):
        require_non_empty(name, getattr(batch, name))
    require_exact_int("record_count", batch.record_count, minimum=1)
    require_exact_int("sequence_start", batch.sequence_start)
    require_exact_int("sequence_end", batch.sequence_end, minimum=1)
    if batch.sequence_end - batch.sequence_start != batch.record_count:
        raise ValueError("sequence range must equal record_count")
    expected_size = batch.detector_events.bytes_per_record * batch.record_count
    if len(batch.detector_events.data) != expected_size:
        raise ValueError("detector_events packed data size does not match record_count")
    for name in ("measurements", "observables", "erasures", "leakage", "heralds"):
        packed = getattr(batch, name)
        if (
            packed.value is not None
            and len(packed.value.data)
            != packed.value.bytes_per_record * batch.record_count
        ):
            raise ValueError(f"{name} packed data size does not match record_count")
    if (
        batch.source_timestamps.value is not None
        and len(batch.source_timestamps.value.values) != batch.record_count
    ):
        raise ValueError("source timestamps must match record_count")
    if len(set(batch.data_quality)) != len(batch.data_quality):
        raise ValueError("data_quality flags must be unique")
    if batch.schema_version != SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SCHEMA_VERSION}")


def _validate_string_tuples(
    name: str, values: tuple[tuple[str, ...], ...], width: int
) -> None:
    for value in values:
        if type(value) is not tuple or len(value) != width:
            raise TypeError(f"{name} entries have invalid tuple shapes")
        if any(not isinstance(item, str) for item in value):
            raise TypeError(f"{name} entries must contain strings")
        require_non_empty(f"{name} identifier", value[0])


def _require_unique(name: str, values: tuple[str, ...]) -> None:
    for value in values:
        require_non_empty(name, value)
    if len(set(values)) != len(values):
        raise ValueError(f"{name} must be unique")


def _validate_provenance_types(record: Any) -> None:
    from .models import AdapterIdentity, ProvenanceOperation, ProvenanceSource

    if type(record.adapter) is not AdapterIdentity:
        raise TypeError("adapter must be AdapterIdentity")
    for name in (
        "sources",
        "mapping_decisions",
        "unit_conversions",
        "revision_references",
        "dependencies",
        "parent_dataset_ids",
        "transformations",
        "filters",
        "exclusions",
        "recipes",
        "annotations",
        "control_audit_refs",
    ):
        require_immutable_tuple(name, getattr(record, name))
    if any(type(source) is not ProvenanceSource for source in record.sources):
        raise TypeError("sources must contain ProvenanceSource")
    if any(
        type(item) is not ProvenanceOperation
        for item in (*record.transformations, *record.recipes)
    ):
        raise TypeError("transformations and recipes must contain ProvenanceOperation")


def validate_provenance_record(record: Any) -> None:
    _validate_provenance_types(record)
    require_non_empty("provenance_id", record.provenance_id)
    require_rfc3339("created_at", record.created_at)
    require_non_empty("runtime", record.runtime)
    require_non_empty("runtime_version", record.runtime_version)
    _require_unique("source_ids", tuple(source.source_id for source in record.sources))
    for name in ("mapping_decisions", "filters", "exclusions"):
        _validate_string_tuples(name, getattr(record, name), 3)
    for name in ("revision_references", "annotations", "dependencies"):
        _validate_string_tuples(name, getattr(record, name), 2)
    for conversion in record.unit_conversions:
        if type(conversion) is not tuple or len(conversion) != 5:
            raise TypeError("unit_conversions entries have invalid tuple shapes")
        for item in conversion[:3]:
            require_non_empty("unit conversion field", item)
        require_finite("unit conversion factor", conversion[3])
        require_finite("unit conversion offset", conversion[4])
    _require_unique("parent_dataset_ids", record.parent_dataset_ids)
    _require_unique("control_audit_refs", record.control_audit_refs)
    if record.schema_version != SCHEMA_VERSION:
        raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
    if not record.sources:
        raise ValueError("provenance requires at least one original source")
