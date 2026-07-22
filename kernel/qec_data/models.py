"""Immutable domain records for QEC data schema version 1.0.0.

Session, syndrome, and decode records have explicit lossless codecs because they
cross durable import and decode boundaries. Calibration and provenance remain
domain objects whose nested audit structures require explicit adapter mapping. A
generic ``asdict`` serializer would silently conflate absent and unavailable values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .model_validation import (
    MIME_PATTERN,
    SCHEMA_VERSION,
    CalibrationQuality,
    CalibrationScopeKind,
    CorrectionKind,
    DataQualityFlag,
    DecodeStatus,
    SessionKind,
    SessionStatus,
    SourcePolicy,
    ValueStatus,
    require_enum as _require_enum,
    require_exact_int as _require_exact_int,
    require_finite as _require_finite,
    require_immutable_tuple as _require_immutable_tuple,
    require_non_empty as _require_non_empty,
    require_rfc3339 as _require_rfc3339,
    utc_now as _utc_now,
    validate_qualified as _validate_qualified,
    validate_provenance_record as _validate_provenance_record,
    validate_sha256 as _validate_sha256,
    validate_syndrome_batch as _validate_syndrome_batch,
)


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
        if self.value is not None:
            _require_finite("qualified number", self.value)


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
        if self.value is not None:
            _require_exact_int("qualified count", self.value)


@dataclass(frozen=True, slots=True)
class PackedBits:
    bit_width: int
    data: bytes

    def __post_init__(self) -> None:
        _require_exact_int("bit_width", self.bit_width, minimum=1)
        if type(self.data) is not bytes:
            raise TypeError("packed data must be immutable bytes")
        if len(self.data) < self.bytes_per_record:
            raise ValueError("packed data size is smaller than one record")
        if len(self.data) % self.bytes_per_record:
            raise ValueError("packed data size must contain complete rows")
        remainder = self.bit_width % 8
        if remainder:
            high_mask = 0xFF ^ ((1 << remainder) - 1)
            final_bytes = self.data[self.bytes_per_record - 1 :: self.bytes_per_record]
            if any(byte & high_mask for byte in final_bytes):
                raise ValueError("packed LSB0 rows must have zero high padding bits")

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
        _require_exact_int("range start", self.start)
        _require_exact_int("range end", self.end, minimum=1)
        if self.end <= self.start:
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
        for value in self.values:
            _require_finite("timestamp", value)
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
        if (
            type(self.unit) is not QualifiedText
            or type(self.tick_period) is not QualifiedFloat
        ):
            raise TypeError("timebase qualified fields have invalid types")
        if self.domain not in {"tick", "round", "timestamp", "custom"}:
            raise ValueError("timebase domain is invalid")


def _validate_session_lifecycle(session: SessionRecord) -> None:
    started = session.started_at.value is not None
    completed = session.completed_at.value is not None
    if session.status is SessionStatus.CREATED and (
        started
        or completed
        or session.started_at.status is not ValueStatus.ABSENT
        or session.completed_at.status is not ValueStatus.ABSENT
    ):
        raise ValueError("created session timestamps must be absent")
    if session.status in {SessionStatus.IMPORTING, SessionStatus.RECORDING}:
        if (
            not started
            or completed
            or session.completed_at.status is not ValueStatus.ABSENT
        ):
            raise ValueError(f"{session.status.value} session requires only started_at")
    if session.status in {SessionStatus.COMPLETE, SessionStatus.PARTIAL}:
        if not started or not completed:
            raise ValueError(f"{session.status.value} session requires both timestamps")
    if session.status is SessionStatus.FAILED and not completed:
        raise ValueError("failed session requires completed_at")


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
        _require_enum("session kind", self.kind, SessionKind)
        _require_enum("session status", self.status, SessionStatus)
        if type(self.adapter) is not AdapterIdentity:
            raise TypeError("adapter must be AdapterIdentity")
        if (
            type(self.started_at) is not QualifiedText
            or type(self.completed_at) is not QualifiedText
        ):
            raise TypeError("session timestamps must be qualified text")
        nested = (
            (self.references, SessionReferences),
            (self.counts, SessionCounts),
            (self.source_clock, SourceClock),
            (self.timebase, Timebase),
        )
        if any(type(value) is not expected for value, expected in nested):
            raise TypeError("session nested records have invalid types")
        _require_non_empty("session_id", self.session_id)
        _require_non_empty("provenance_id", self.provenance_id)
        _require_rfc3339("created_at", self.created_at)
        if self.started_at.value is not None:
            _require_rfc3339("started_at", self.started_at.value)
        if self.completed_at.value is not None:
            _require_rfc3339("completed_at", self.completed_at.value)
        _require_immutable_tuple("segments", self.segments)
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version must be {SCHEMA_VERSION}")
        if len(set(self.segments)) != len(self.segments):
            raise ValueError("segments must be unique")
        for segment in self.segments:
            _require_non_empty("segment", segment)
        _validate_session_lifecycle(self)

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
        _validate_syndrome_batch(self)


@dataclass(frozen=True, slots=True)
class DecodeInput:
    batch_id: str
    sequence_start: int
    sequence_end: int

    def __post_init__(self) -> None:
        _require_non_empty("batch_id", self.batch_id)
        _require_exact_int("decode sequence_start", self.sequence_start)
        _require_exact_int("decode sequence_end", self.sequence_end, minimum=1)
        if self.sequence_end <= self.sequence_start:
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
            _require_finite("quantity", self.value)
            if self.value < 0:
                raise ValueError("quantity cannot be negative")
            _require_non_empty("quantity unit", self.unit or "")


UNAVAILABLE_QUANTITY = QualifiedQuantity(None, None, ValueStatus.UNAVAILABLE)


@dataclass(frozen=True, slots=True)
class CorrectionValue:
    kind: CorrectionKind
    edge_ids: tuple[str, ...] = ()
    compact_ref: str | None = None

    def __post_init__(self) -> None:
        _require_enum("correction kind", self.kind, CorrectionKind)
        _require_immutable_tuple("correction edge_ids", self.edge_ids)
        if self.kind is CorrectionKind.EDGE_IDS:
            if not self.edge_ids or self.compact_ref is not None:
                raise ValueError("edge_ids correction requires only nonempty edge_ids")
            if len(set(self.edge_ids)) != len(self.edge_ids):
                raise ValueError("correction edge_ids must be unique")
            for edge_id in self.edge_ids:
                _require_non_empty("correction edge_id", edge_id)
        elif self.edge_ids or self.compact_ref is None:
            raise ValueError("compact_ref correction requires only compact_ref")
        if self.compact_ref is not None:
            _require_non_empty("correction compact_ref", self.compact_ref)

    @classmethod
    def edges(cls, edge_ids: tuple[str, ...]) -> CorrectionValue:
        return cls(CorrectionKind.EDGE_IDS, edge_ids=edge_ids)

    @classmethod
    def compact(cls, compact_ref: str) -> CorrectionValue:
        return cls(CorrectionKind.COMPACT_REF, compact_ref=compact_ref)


@dataclass(frozen=True, slots=True)
class QualifiedCorrection:
    value: CorrectionValue | None
    status: ValueStatus

    def __post_init__(self) -> None:
        _validate_qualified("qualified correction", self.value, self.status)
        if self.value is not None and type(self.value) is not CorrectionValue:
            raise TypeError("qualified correction value must be CorrectionValue")


@dataclass(frozen=True, slots=True)
class DecodeError:
    code: str
    message: str

    def __post_init__(self) -> None:
        _require_non_empty("decode error code", self.code)
        _require_non_empty("decode error message", self.message)


UNAVAILABLE_CORRECTION = QualifiedCorrection(None, ValueStatus.UNAVAILABLE)


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
    correction: QualifiedCorrection = UNAVAILABLE_CORRECTION
    known_truth: QualifiedPackedBits = UNKNOWN_BITS
    pipeline_latency: QualifiedQuantity = UNAVAILABLE_QUANTITY
    total_latency: QualifiedQuantity = UNAVAILABLE_QUANTITY
    error: DecodeError | None = None
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        _require_enum("decode status", self.status, DecodeStatus)
        if (
            type(self.input) is not DecodeInput
            or type(self.decoder) is not DecoderIdentity
        ):
            raise TypeError("decode input and decoder have invalid types")
        if (
            type(self.prediction) is not PackedBits
            or type(self.predicted_logical_flips) is not PackedBits
        ):
            raise TypeError("decode predictions must be PackedBits")
        if (
            type(self.confidence) is not QualifiedFloat
            or type(self.known_truth) is not QualifiedPackedBits
        ):
            raise TypeError("decode qualified fields have invalid types")
        if (
            type(self.pipeline_latency) is not QualifiedQuantity
            or type(self.total_latency) is not QualifiedQuantity
        ):
            raise TypeError("decode latencies must be QualifiedQuantity")
        if self.error is not None and type(self.error) is not DecodeError:
            raise TypeError("error must be DecodeError")
        _require_non_empty("decode_id", self.decode_id)
        _require_non_empty("session_id", self.session_id)
        _require_non_empty("provenance_id", self.provenance_id)
        if type(self.correction) is not QualifiedCorrection:
            raise TypeError("correction must be QualifiedCorrection")
        failed = self.status in {DecodeStatus.ERROR, DecodeStatus.TIMEOUT}
        if failed != (self.error is not None):
            raise ValueError(
                "decode error must be present exactly for error or timeout status"
            )
        record_count = self.input.sequence_end - self.input.sequence_start
        for name, packed in (
            ("prediction", self.prediction),
            ("predicted_logical_flips", self.predicted_logical_flips),
        ):
            if len(packed.data) != packed.bytes_per_record * record_count:
                raise ValueError(f"{name} rows must match decode sequence range")
        if self.known_truth.value is not None:
            if (
                len(self.known_truth.value.data)
                != self.known_truth.value.bytes_per_record * record_count
            ):
                raise ValueError("known_truth rows must match decode sequence range")
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
    kind: CalibrationScopeKind
    id: str

    def __post_init__(self) -> None:
        _require_enum("calibration scope kind", self.kind, CalibrationScopeKind)
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
    quality: CalibrationQuality
    source_system: str
    provenance_id: str
    effective_start: str = field(default_factory=_utc_now)
    effective_end: str | None = None
    calibration_run_id: str | None = None
    original_mime_type: str = "application/octet-stream"
    original_representation: str = ""
    schema_version: str = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if type(self.scope) is not CalibrationScope:
            raise TypeError("scope must be CalibrationScope")
        if any(
            type(item) is not expected
            for item, expected in (
                (self.value, QualifiedFloat),
                (self.unit, QualifiedText),
                (self.uncertainty, QualifiedFloat),
            )
        ):
            raise TypeError("calibration qualified fields have invalid types")
        for name, value in (
            ("calibration_id", self.calibration_id),
            ("session_id", self.session_id),
            ("parameter_name", self.parameter_name),
            ("semantic_id", self.semantic_id),
            ("source_system", self.source_system),
            ("provenance_id", self.provenance_id),
        ):
            _require_non_empty(name, value)
        _require_enum("calibration quality", self.quality, CalibrationQuality)
        _require_rfc3339("effective_start", self.effective_start)
        if self.effective_end is not None:
            _require_rfc3339("effective_end", self.effective_end)
            start = datetime.fromisoformat(self.effective_start.replace("Z", "+00:00"))
            end = datetime.fromisoformat(self.effective_end.replace("Z", "+00:00"))
            if end < start:
                raise ValueError("effective_end cannot precede effective_start")
        if self.calibration_run_id is not None:
            _require_non_empty("calibration_run_id", self.calibration_run_id)
        if not isinstance(self.original_representation, str):
            raise TypeError("original_representation must be a string")
        if not MIME_PATTERN.fullmatch(self.original_mime_type):
            raise ValueError("original_mime_type must be a MIME type")
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
            quality=CalibrationQuality.UNKNOWN,
            source_system=source_system,
            provenance_id=provenance_id,
        )


@dataclass(frozen=True, slots=True)
class ProvenanceSource:
    source_id: str
    uri: str
    sha256: str
    policy: SourcePolicy

    def __post_init__(self) -> None:
        _require_non_empty("source_id", self.source_id)
        _require_non_empty("source uri", self.uri)
        _validate_sha256("source", self.sha256)
        _require_enum("source policy", self.policy, SourcePolicy)


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
        for _, value in self.parameters:
            if isinstance(value, float):
                _require_finite("parameter value", value)


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
        _validate_provenance_record(self)
