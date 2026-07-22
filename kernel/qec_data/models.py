"""Immutable domain records for QEC data schema version 1.0.0.

Session and syndrome records have explicit lossless codecs because they cross the
durable import boundary. Decode, calibration, and provenance records deliberately
remain domain objects: their schema representations contain tagged alternatives
and nested audit operations that storage adapters must map explicitly. A generic
``asdict`` serializer would silently conflate absent and unavailable values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum


SCHEMA_VERSION = "1.0.0"
SHA256_LENGTH = 64


def _utc_now() -> str:
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


NULL_STATUSES = frozenset(
    {ValueStatus.ABSENT, ValueStatus.UNAVAILABLE, ValueStatus.UNKNOWN}
)


def _require_non_empty(name: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def _validate_qualified(name: str, value: object | None, status: ValueStatus) -> None:
    if status in NULL_STATUSES and value is not None:
        raise ValueError(f"{name} must be null when status is {status.value}")
    if status not in NULL_STATUSES and value is None:
        raise ValueError(f"{name} must have a value when status is {status.value}")


def _validate_sha256(name: str, value: str) -> None:
    if len(value) != SHA256_LENGTH or any(
        char not in "0123456789abcdef" for char in value
    ):
        raise ValueError(f"{name} must be a lowercase SHA-256 hex digest")


def _contains_mutable(value: object) -> bool:
    if isinstance(value, (list, dict, set, bytearray)):
        return True
    return isinstance(value, tuple) and any(_contains_mutable(item) for item in value)


def _require_immutable_tuple(name: str, value: object) -> None:
    if not isinstance(value, tuple) or _contains_mutable(value):
        raise TypeError(f"{name} must be an immutable tuple")


@dataclass(frozen=True, slots=True)
class AdapterIdentity:
    id: str
    version: str

    def __post_init__(self) -> None:
        _require_non_empty("adapter id", self.id)
        _require_non_empty("adapter version", self.version)


@dataclass(frozen=True, slots=True)
class QualifiedFloat:
    value: float | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("qualified number", self.value, self.status)


@dataclass(frozen=True, slots=True)
class QualifiedText:
    value: str | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("qualified text", self.value, self.status)
        if self.value is not None:
            _require_non_empty("qualified text", self.value)


@dataclass(frozen=True, slots=True)
class QualifiedCount:
    value: int | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("qualified count", self.value, self.status)
        if self.value is not None and self.value < 0:
            raise ValueError("qualified count cannot be negative")


@dataclass(frozen=True, slots=True)
class PackedBits:
    bit_width: int
    data: bytes

    def __post_init__(self) -> None:
        if self.bit_width < 1:
            raise ValueError("bit_width must be positive")
        if type(self.data) is not bytes:
            raise TypeError("packed data must be immutable bytes")
        if len(self.data) < self.bytes_per_record:
            raise ValueError("packed data size is smaller than one record")

    @property
    def bytes_per_record(self) -> int:
        return (self.bit_width + 7) // 8


@dataclass(frozen=True, slots=True)
class QualifiedPackedBits:
    value: PackedBits | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("qualified packed bits", self.value, self.status)


@dataclass(frozen=True, slots=True)
class IndexRange:
    start: int
    end: int

    def __post_init__(self) -> None:
        if self.start < 0 or self.end <= self.start:
            raise ValueError("range must be non-negative and non-empty")


@dataclass(frozen=True, slots=True)
class QualifiedRange:
    value: IndexRange | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("qualified range", self.value, self.status)


@dataclass(frozen=True, slots=True)
class TimestampSeries:
    values: tuple[float, ...]
    unit: str

    def __post_init__(self) -> None:
        _require_immutable_tuple("timestamp values", self.values)
        _require_non_empty("timestamp unit", self.unit)


@dataclass(frozen=True, slots=True)
class QualifiedTimestamps:
    value: TimestampSeries | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("source timestamps", self.value, self.status)


UNKNOWN_TEXT = QualifiedText(None, ValueStatus.UNKNOWN)
UNAVAILABLE_TEXT = QualifiedText(None, ValueStatus.UNAVAILABLE)
UNKNOWN_COUNT = QualifiedCount(None, ValueStatus.UNKNOWN)
ABSENT_RANGE = QualifiedRange(None, ValueStatus.ABSENT)
UNKNOWN_RANGE = QualifiedRange(None, ValueStatus.UNKNOWN)
UNAVAILABLE_TIMESTAMPS = QualifiedTimestamps(None, ValueStatus.UNAVAILABLE)
ABSENT_BITS = QualifiedPackedBits(None, ValueStatus.ABSENT)
UNKNOWN_BITS = QualifiedPackedBits(None, ValueStatus.UNKNOWN)
UNAVAILABLE_FLOAT = QualifiedFloat(None, ValueStatus.UNAVAILABLE)


@dataclass(frozen=True, slots=True)
class SessionReferences:
    circuit: QualifiedText = UNKNOWN_TEXT
    detector_error_model: QualifiedText = UNKNOWN_TEXT
    topology: QualifiedText = UNKNOWN_TEXT
    calibration: QualifiedText = UNAVAILABLE_TEXT


@dataclass(frozen=True, slots=True)
class SessionCounts:
    detectors: QualifiedCount = UNKNOWN_COUNT
    observables: QualifiedCount = UNKNOWN_COUNT
    measurements: QualifiedCount = UNKNOWN_COUNT
    logical_patches: QualifiedCount = UNKNOWN_COUNT


@dataclass(frozen=True, slots=True)
class SourceClock:
    identity: QualifiedText = UNAVAILABLE_TEXT
    description: str = ""


@dataclass(frozen=True, slots=True)
class Timebase:
    domain: str = "custom"
    unit: QualifiedText = UNKNOWN_TEXT
    tick_period: QualifiedFloat = UNAVAILABLE_FLOAT
    description: str = ""

    def __post_init__(self) -> None:
        if self.domain not in {"tick", "round", "timestamp", "custom"}:
            raise ValueError("timebase domain is invalid")


@dataclass(frozen=True, slots=True)
class SessionRecord:
    session_id: str
    kind: SessionKind
    status: SessionStatus
    adapter: AdapterIdentity
    provenance_id: str
    created_at: str = field(default_factory=_utc_now)
    started_at: QualifiedText = QualifiedText(None, ValueStatus.ABSENT)
    completed_at: QualifiedText = QualifiedText(None, ValueStatus.ABSENT)
    references: SessionReferences = SessionReferences()
    counts: SessionCounts = SessionCounts()
    source_clock: SourceClock = SourceClock()
    timebase: Timebase = Timebase()
    segments: tuple[str, ...] = ()
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        _require_non_empty("session_id", self.session_id)
        _require_non_empty("provenance_id", self.provenance_id)
        _require_non_empty("created_at", self.created_at)
        _require_immutable_tuple("segments", self.segments)
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
        if len(set(self.segments)) != len(self.segments):
            raise ValueError("segments must be unique")
        for segment in self.segments:
            _require_non_empty("segment", segment)

    @classmethod
    def minimal(
        cls,
        session_id: str,
        kind: SessionKind,
        adapter_id: str,
        adapter_version: str,
        provenance_id: str,
    ) -> SessionRecord:
        return cls(
            session_id=session_id,
            kind=kind,
            status=SessionStatus.CREATED,
            adapter=AdapterIdentity(adapter_id, adapter_version),
            provenance_id=provenance_id,
        )


def _validate_batch_buffer(name: str, packed: QualifiedPackedBits, count: int) -> None:
    if (
        packed.value is not None
        and len(packed.value.data) != packed.value.bytes_per_record * count
    ):
        raise ValueError(f"{name} packed data size does not match record_count")


@dataclass(frozen=True, slots=True)
class SyndromeBatch:
    batch_id: str
    session_id: str
    segment_id: str
    sequence_start: int
    sequence_end: int
    record_count: int
    detector_events: PackedBits
    provenance_id: str
    shot_range: QualifiedRange = ABSENT_RANGE
    round_range: QualifiedRange = UNKNOWN_RANGE
    source_timestamps: QualifiedTimestamps = UNAVAILABLE_TIMESTAMPS
    measurements: QualifiedPackedBits = ABSENT_BITS
    observables: QualifiedPackedBits = ABSENT_BITS
    erasures: QualifiedPackedBits = ABSENT_BITS
    leakage: QualifiedPackedBits = ABSENT_BITS
    heralds: QualifiedPackedBits = ABSENT_BITS
    circuit_revision: QualifiedText = UNKNOWN_TEXT
    topology_revision: QualifiedText = UNKNOWN_TEXT
    data_quality: tuple[DataQualityFlag, ...] = (DataQualityFlag.COMPLETE,)
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        for name, value in (
            ("batch_id", self.batch_id),
            ("session_id", self.session_id),
            ("segment_id", self.segment_id),
            ("provenance_id", self.provenance_id),
        ):
            _require_non_empty(name, value)
        _require_immutable_tuple("data_quality", self.data_quality)
        if self.record_count < 1:
            raise ValueError("record_count must be positive")
        if (
            self.sequence_start < 0
            or self.sequence_end - self.sequence_start != self.record_count
        ):
            raise ValueError("sequence range must equal record_count")
        expected_size = self.detector_events.bytes_per_record * self.record_count
        if len(self.detector_events.data) != expected_size:
            raise ValueError(
                "detector_events packed data size does not match record_count"
            )
        for name in ("measurements", "observables", "erasures", "leakage", "heralds"):
            _validate_batch_buffer(name, getattr(self, name), self.record_count)
        if (
            self.source_timestamps.value is not None
            and len(self.source_timestamps.value.values) != self.record_count
        ):
            raise ValueError("source timestamps must match record_count")
        if len(set(self.data_quality)) != len(self.data_quality):
            raise ValueError("data_quality flags must be unique")
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")


@dataclass(frozen=True, slots=True)
class DecodeInput:
    batch_id: str
    sequence_start: int
    sequence_end: int

    def __post_init__(self) -> None:
        _require_non_empty("batch_id", self.batch_id)
        if self.sequence_start < 0 or self.sequence_end <= self.sequence_start:
            raise ValueError("decode sequence range must be non-empty")


@dataclass(frozen=True, slots=True)
class DecoderIdentity:
    name: str
    version: str
    configuration_sha256: str

    def __post_init__(self) -> None:
        _require_non_empty("decoder name", self.name)
        _require_non_empty("decoder version", self.version)
        _validate_sha256("decoder configuration", self.configuration_sha256)


@dataclass(frozen=True, slots=True)
class QualifiedQuantity:
    value: float | None
    unit: str | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("quantity", self.value, self.status)
        if self.value is None and self.unit is not None:
            raise ValueError("quantity unit must be null when value is null")
        if self.value is not None:
            if self.value < 0:
                raise ValueError("quantity cannot be negative")
            _require_non_empty("quantity unit", self.unit or "")


UNAVAILABLE_QUANTITY = QualifiedQuantity(None, None, ValueStatus.UNAVAILABLE)


@dataclass(frozen=True, slots=True)
class DecodeRecord:
    decode_id: str
    session_id: str
    input: DecodeInput
    decoder: DecoderIdentity
    status: DecodeStatus
    prediction: PackedBits
    predicted_logical_flips: PackedBits
    provenance_id: str
    confidence: QualifiedFloat = UNAVAILABLE_FLOAT
    correction_edge_ids: tuple[str, ...] | None = None
    correction_ref: QualifiedText = UNAVAILABLE_TEXT
    known_truth: QualifiedPackedBits = UNKNOWN_BITS
    pipeline_latency: QualifiedQuantity = UNAVAILABLE_QUANTITY
    total_latency: QualifiedQuantity = UNAVAILABLE_QUANTITY
    error_code: str | None = None
    error_message: str | None = None
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        _require_non_empty("decode_id", self.decode_id)
        _require_non_empty("session_id", self.session_id)
        _require_non_empty("provenance_id", self.provenance_id)
        if self.correction_edge_ids is not None:
            _require_immutable_tuple("correction_edge_ids", self.correction_edge_ids)
        if (self.error_code is None) != (self.error_message is None):
            raise ValueError("decode error code and message must be provided together")
        if (
            self.status in {DecodeStatus.ERROR, DecodeStatus.TIMEOUT}
            and self.error_code is None
        ):
            raise ValueError("failed decode status requires an error")
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")

    @classmethod
    def minimal(
        cls,
        *,
        decode_id: str,
        session_id: str,
        batch_id: str,
        decoder: AdapterIdentity,
        configuration_sha256: str,
        prediction: PackedBits,
        predicted_logical_flips: PackedBits,
        provenance_id: str,
    ) -> DecodeRecord:
        return cls(
            decode_id=decode_id,
            session_id=session_id,
            input=DecodeInput(batch_id, 0, 1),
            decoder=DecoderIdentity(decoder.id, decoder.version, configuration_sha256),
            status=DecodeStatus.COMPLETE,
            prediction=prediction,
            predicted_logical_flips=predicted_logical_flips,
            provenance_id=provenance_id,
        )


@dataclass(frozen=True, slots=True)
class CalibrationScope:
    kind: str
    id: str

    def __post_init__(self) -> None:
        valid = {
            "device",
            "patch",
            "qubit",
            "coupler",
            "resonator",
            "readout_channel",
            "custom",
        }
        if self.kind not in valid:
            raise ValueError("calibration scope kind is invalid")
        _require_non_empty("calibration scope id", self.id)


@dataclass(frozen=True, slots=True)
class CalibrationRecord:
    calibration_id: str
    session_id: str
    scope: CalibrationScope
    parameter_name: str
    semantic_id: str
    value: QualifiedFloat
    unit: QualifiedText
    uncertainty: QualifiedFloat
    quality: str
    source_system: str
    provenance_id: str
    effective_start: str = field(default_factory=_utc_now)
    effective_end: str | None = None
    calibration_run_id: str | None = None
    original_mime_type: str = "application/octet-stream"
    original_representation: str = ""
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        for name, value in (
            ("calibration_id", self.calibration_id),
            ("session_id", self.session_id),
            ("parameter_name", self.parameter_name),
            ("semantic_id", self.semantic_id),
            ("source_system", self.source_system),
            ("provenance_id", self.provenance_id),
        ):
            _require_non_empty(name, value)
        if self.quality not in {"accepted", "suspect", "rejected", "unknown"}:
            raise ValueError("calibration quality is invalid")
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")

    @classmethod
    def minimal(
        cls,
        *,
        calibration_id: str,
        session_id: str,
        scope: CalibrationScope,
        parameter_name: str,
        semantic_id: str,
        source_system: str,
        provenance_id: str,
    ) -> CalibrationRecord:
        return cls(
            calibration_id=calibration_id,
            session_id=session_id,
            scope=scope,
            parameter_name=parameter_name,
            semantic_id=semantic_id,
            value=QualifiedFloat(None, ValueStatus.UNKNOWN),
            unit=UNKNOWN_TEXT,
            uncertainty=QualifiedFloat(None, ValueStatus.UNAVAILABLE),
            quality="unknown",
            source_system=source_system,
            provenance_id=provenance_id,
        )


@dataclass(frozen=True, slots=True)
class ProvenanceSource:
    source_id: str
    uri: str
    sha256: str
    policy: str

    def __post_init__(self) -> None:
        _require_non_empty("source_id", self.source_id)
        _require_non_empty("source uri", self.uri)
        _validate_sha256("source", self.sha256)
        if self.policy not in {"copy", "reference"}:
            raise ValueError("source policy must be copy or reference")


ScalarValue = str | int | float | bool | None


@dataclass(frozen=True, slots=True)
class ProvenanceOperation:
    id: str
    version: str
    parameters: tuple[tuple[str, ScalarValue], ...]

    def __post_init__(self) -> None:
        _require_non_empty("operation id", self.id)
        _require_non_empty("operation version", self.version)
        _require_immutable_tuple("parameters", self.parameters)
        keys = tuple(key for key, _ in self.parameters)
        if any(not isinstance(key, str) or not key for key in keys):
            raise ValueError("parameter keys must be non-empty strings")
        if len(set(keys)) != len(keys):
            raise ValueError("parameter keys must be unique")
        scalar_types = (str, int, float, bool, type(None))
        if any(not isinstance(value, scalar_types) for _, value in self.parameters):
            raise TypeError("parameter values must be JSON scalars")


@dataclass(frozen=True, slots=True)
class ProvenanceRecord:
    provenance_id: str
    created_at: str
    adapter: AdapterIdentity
    sources: tuple[ProvenanceSource, ...] = ()
    mapping_decisions: tuple[tuple[str, str, str], ...] = ()
    unit_conversions: tuple[tuple[str, str, str, float, float], ...] = ()
    revision_references: tuple[tuple[str, str], ...] = ()
    runtime: str = "python"
    runtime_version: str = "unknown"
    dependencies: tuple[tuple[str, str], ...] = ()
    parent_dataset_ids: tuple[str, ...] = ()
    transformations: tuple[ProvenanceOperation, ...] = ()
    filters: tuple[tuple[str, str, str], ...] = ()
    exclusions: tuple[tuple[str, str, str], ...] = ()
    recipes: tuple[ProvenanceOperation, ...] = ()
    annotations: tuple[tuple[str, str], ...] = ()
    control_audit_refs: tuple[str, ...] = ()
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        _require_non_empty("provenance_id", self.provenance_id)
        _require_non_empty("created_at", self.created_at)
        _require_non_empty("runtime", self.runtime)
        _require_non_empty("runtime_version", self.runtime_version)
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
            _require_immutable_tuple(name, getattr(self, name))
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
        if not self.sources:
            raise ValueError("provenance requires at least one original source")
