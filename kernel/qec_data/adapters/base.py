"""Frozen public contract for QEC data adapters.

The method names and positional arguments in :class:`QecDataAdapter` are the
cross-plan contract.  Live adapters receive cancellation through
``StreamConfig.cancel``; offline iterators remain synchronously closeable.
"""

from __future__ import annotations

import hashlib
import math
import os
import stat
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol, TypeAlias, runtime_checkable

from kernel.qec_data.models import SyndromeBatch


CanonicalBatch: TypeAlias = SyndromeBatch
ScalarValue: TypeAlias = str | int | float | bool | None | tuple["ScalarValue", ...]
SHA256_HEX_LENGTH = 64
MAX_METADATA_DEPTH = 32
MAX_SAFE_METADATA_INTEGER = (1 << 53) - 1


def _require_text(name: str, value: str) -> None:
    if type(value) is not str or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def _require_tuple(name: str, value: object) -> None:
    if type(value) is not tuple:
        raise TypeError(f"{name} must be an immutable tuple")


def _require_unique_text(name: str, values: tuple[str, ...]) -> None:
    _require_tuple(name, values)
    for value in values:
        _require_text(name, value)
    if len(values) != len(set(values)):
        raise ValueError(f"{name} must contain unique values")


def _require_pairs(name: str, values: tuple[tuple[str, object], ...]) -> None:
    _require_tuple(name, values)
    keys: list[str] = []
    for pair in values:
        if type(pair) is not tuple or len(pair) != 2:
            raise TypeError(f"{name} entries must be immutable key/value pairs")
        key, _ = pair
        _require_text(f"{name} key", key)
        keys.append(key)
    if len(keys) != len(set(keys)):
        raise ValueError(f"{name} keys must be unique")


def _validate_metadata(name: str, value: ScalarValue, depth: int = 0) -> None:
    if depth > MAX_METADATA_DEPTH:
        raise ValueError(f"{name} exceeds maximum metadata depth")
    if value is None or type(value) in {str, bool}:
        return
    if type(value) is int:
        if abs(value) > MAX_SAFE_METADATA_INTEGER:
            raise ValueError(f"{name} integers must be JavaScript-safe")
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError(f"{name} numbers must be finite")
        return
    if type(value) is tuple:
        for item in value:
            _validate_metadata(name, item, depth + 1)
        return
    raise TypeError(f"{name} values must be immutable JSON metadata")


def _require_scalar_pairs(
    name: str, values: tuple[tuple[str, ScalarValue], ...]
) -> None:
    _require_pairs(name, values)
    for _, value in values:
        _validate_metadata(name, value)


def _require_string_pairs(name: str, values: tuple[tuple[str, str], ...]) -> None:
    _require_pairs(name, values)
    for _, value in values:
        _require_text(f"{name} value", value)


def _validate_sha256(name: str, value: str | None) -> None:
    if value is None:
        return
    if (
        type(value) is not str
        or len(value) != SHA256_HEX_LENGTH
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"{name} must be a lowercase SHA-256 hex digest")


def _reject_symlink(path: Path) -> None:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise ValueError(f"adapter source cannot be inspected: {path}") from error
    if stat.S_ISLNK(mode):
        raise ValueError(f"adapter source must not contain symlinks: {path}")


def _source_paths(source: Path) -> tuple[Path, ...]:
    _reject_symlink(source)
    if source.is_file():
        return (source,)
    if not source.is_dir():
        raise FileNotFoundError(f"QEC adapter source does not exist: {source}")
    paths = tuple(sorted(source.rglob("*"), key=lambda item: item.as_posix()))
    for path in paths:
        _reject_symlink(path)
    return paths


def _sha256_regular_file(path: Path) -> str:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(
            f"adapter source file cannot be opened safely: {path}"
        ) from error
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError(f"adapter source is not a regular file: {path}")
        with os.fdopen(descriptor, "rb", closefd=False) as source_file:
            return hashlib.file_digest(source_file, "sha256").hexdigest()
    finally:
        os.close(descriptor)


def compute_source_sha256(source: Path) -> str:
    """Return a deterministic content identity without rewriting the source."""

    paths = _source_paths(source)
    if len(paths) == 1 and paths[0] == source and source.is_file():
        return _sha256_regular_file(source)
    digest = hashlib.sha256()
    for path in paths:
        relative = path.relative_to(source).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        if path.is_file():
            digest.update(b"F" + bytes.fromhex(_sha256_regular_file(path)))
        else:
            digest.update(b"D")
    return digest.hexdigest()


@dataclass(frozen=True, slots=True)
class SourceFingerprintEntry:
    relative_path: str
    kind: str
    mode: int
    size: int
    modified_ns: int
    changed_ns: int
    device: int
    inode: int
    content_sha256: str


def fingerprint_source(source: Path) -> tuple[SourceFingerprintEntry, ...]:
    """Fingerprint source content and mutation-relevant metadata."""

    paths = (source,) if source.is_file() else (source, *_source_paths(source))
    entries: list[SourceFingerprintEntry] = []
    for path in paths:
        _reject_symlink(path)
        status = path.lstat()
        regular = stat.S_ISREG(status.st_mode)
        relative = "." if path == source else path.relative_to(source).as_posix()
        entries.append(
            SourceFingerprintEntry(
                relative,
                "file" if regular else "directory",
                status.st_mode,
                status.st_size,
                status.st_mtime_ns,
                status.st_ctime_ns,
                status.st_dev,
                status.st_ino,
                _sha256_regular_file(path) if regular else "",
            )
        )
    return tuple(entries)


class AdapterCapability(StrEnum):
    PROBE = "probe"
    VALIDATE = "validate"
    PREVIEW = "preview"
    IMPORT = "import_batches"
    STREAM = "stream_batches"
    COMMAND = "command"


CORE_CAPABILITIES = frozenset(
    {
        AdapterCapability.PROBE,
        AdapterCapability.VALIDATE,
        AdapterCapability.PREVIEW,
        AdapterCapability.IMPORT,
    }
)


class ValidationSeverity(StrEnum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass(frozen=True, slots=True)
class AdapterManifest:
    id: str
    version: str
    capabilities: frozenset[AdapterCapability]
    source_kinds: tuple[str, ...]

    def __post_init__(self) -> None:
        _require_text("adapter id", self.id)
        _require_text("adapter version", self.version)
        if type(self.capabilities) is not frozenset:
            raise TypeError("adapter capabilities must be a frozenset")
        if not all(type(item) is AdapterCapability for item in self.capabilities):
            raise TypeError("adapter capabilities contain an invalid capability")
        if not CORE_CAPABILITIES.issubset(self.capabilities):
            raise ValueError("adapter manifest must declare all core capabilities")
        _require_unique_text("adapter source kinds", self.source_kinds)
        if not self.source_kinds:
            raise ValueError("adapter source kinds must not be empty")


@dataclass(frozen=True, slots=True)
class ProbeResult:
    supported: bool
    source_kind: str | None = None
    confidence: float = 1.0
    source_sha256: str | None = None
    details: tuple[tuple[str, ScalarValue], ...] = ()

    def __post_init__(self) -> None:
        if type(self.supported) is not bool:
            raise TypeError("probe supported must be a boolean")
        if self.source_kind is not None:
            _require_text("probe source kind", self.source_kind)
        if type(self.confidence) not in {int, float} or not math.isfinite(
            self.confidence
        ):
            raise TypeError("probe confidence must be a finite number")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("probe confidence must be between zero and one")
        _validate_sha256("probe source hash", self.source_sha256)
        _require_scalar_pairs("probe details", self.details)


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    code: str
    message: str
    severity: ValidationSeverity = ValidationSeverity.ERROR
    field: str | None = None

    def __post_init__(self) -> None:
        _require_text("validation issue code", self.code)
        _require_text("validation issue message", self.message)
        if self.field is not None:
            _require_text("validation issue field", self.field)
        if type(self.severity) is not ValidationSeverity:
            raise TypeError("validation issue severity must be ValidationSeverity")


@dataclass(frozen=True, slots=True)
class ValidationReport:
    valid: bool
    issues: tuple[ValidationIssue, ...] = ()
    source_sha256: str | None = None
    provenance_id: str | None = None

    def __post_init__(self) -> None:
        if type(self.valid) is not bool:
            raise TypeError("validation valid must be a boolean")
        _require_tuple("validation issues", self.issues)
        if not all(type(issue) is ValidationIssue for issue in self.issues):
            raise TypeError("validation issues contain an invalid issue")
        has_error = any(
            issue.severity is ValidationSeverity.ERROR for issue in self.issues
        )
        if self.valid and has_error:
            raise ValueError("a valid report cannot contain error issues")
        if not self.valid and not has_error:
            raise ValueError("an invalid report must contain an error issue")
        _validate_sha256("validation source hash", self.source_sha256)
        if self.provenance_id is not None:
            _require_text("validation provenance id", self.provenance_id)


@dataclass(frozen=True, slots=True)
class ImportMapping:
    fields: tuple[tuple[str, str], ...] = ()
    options: tuple[tuple[str, ScalarValue], ...] = ()
    expected_provenance_id: str | None = None

    def __post_init__(self) -> None:
        _require_string_pairs("import fields", self.fields)
        _require_scalar_pairs("import options", self.options)
        if self.expected_provenance_id is not None:
            _require_text("expected provenance id", self.expected_provenance_id)


@dataclass(frozen=True, slots=True)
class PreviewResult:
    batches: tuple[CanonicalBatch, ...]
    truncated: bool
    total_records: int | None = None
    source_sha256: str | None = None
    provenance_id: str | None = None

    def __post_init__(self) -> None:
        _require_tuple("preview batches", self.batches)
        if not all(type(batch) is SyndromeBatch for batch in self.batches):
            raise TypeError("preview batches contain a non-canonical batch")
        if type(self.truncated) is not bool:
            raise TypeError("preview truncated must be a boolean")
        if self.total_records is not None and (
            type(self.total_records) is not int or self.total_records < 0
        ):
            raise ValueError("preview total records cannot be negative")
        preview_records = sum(batch.record_count for batch in self.batches)
        if self.total_records is not None and self.total_records < preview_records:
            raise ValueError("preview total records cannot be smaller than its batches")
        if self.total_records is not None and not self.truncated:
            if self.total_records != preview_records:
                raise ValueError("complete preview total must equal its batch records")
        _validate_sha256("preview source hash", self.source_sha256)
        if self.provenance_id is not None:
            _require_text("preview provenance id", self.provenance_id)


@runtime_checkable
class CancellationToken(Protocol):
    @property
    def is_cancelled(self) -> bool: ...

    def raise_if_cancelled(self) -> None: ...


class AdapterCancelled(RuntimeError):
    """Raised when an adapter cooperatively observes cancellation."""


@dataclass(frozen=True, slots=True)
class NeverCancelled:
    @property
    def is_cancelled(self) -> bool:
        return False

    def raise_if_cancelled(self) -> None:
        return None


@dataclass(frozen=True, slots=True)
class AlreadyCancelled:
    @property
    def is_cancelled(self) -> bool:
        return True

    def raise_if_cancelled(self) -> None:
        raise AdapterCancelled("adapter operation was cancelled")


@dataclass(frozen=True, slots=True)
class StreamConfig:
    source_kind: str
    options: tuple[tuple[str, ScalarValue], ...] = ()
    cancel: CancellationToken = NeverCancelled()

    def __post_init__(self) -> None:
        _require_text("stream source kind", self.source_kind)
        _require_scalar_pairs("stream options", self.options)
        if not isinstance(self.cancel, CancellationToken):
            raise TypeError("stream cancellation token is invalid")


@dataclass(frozen=True, slots=True)
class AdapterCommand:
    name: str
    parameters: tuple[tuple[str, ScalarValue], ...] = ()

    def __post_init__(self) -> None:
        _require_text("adapter command name", self.name)
        _require_scalar_pairs("adapter command parameters", self.parameters)


@dataclass(frozen=True, slots=True)
class CommandSuccessResult:
    code: str = "ok"
    details: tuple[tuple[str, ScalarValue], ...] = ()

    def __post_init__(self) -> None:
        _require_text("command result code", self.code)
        _require_scalar_pairs("command result details", self.details)


@dataclass(frozen=True, slots=True)
class UnsupportedCapabilityResult:
    capability: AdapterCapability
    message: str
    code: str = "unsupported_capability"

    def __post_init__(self) -> None:
        if type(self.capability) is not AdapterCapability:
            raise TypeError("unsupported capability must be AdapterCapability")
        _require_text("unsupported capability message", self.message)
        if self.code != "unsupported_capability":
            raise ValueError("unsupported result code must be unsupported_capability")


CommandResult: TypeAlias = CommandSuccessResult | UnsupportedCapabilityResult


@runtime_checkable
class QecDataAdapter(Protocol):
    manifest: AdapterManifest

    def probe(self, source: Path) -> ProbeResult: ...

    def validate(self, source: Path, mapping: ImportMapping) -> ValidationReport: ...

    def preview(
        self, source: Path, mapping: ImportMapping, limit: int
    ) -> PreviewResult: ...

    def import_batches(
        self, source: Path, mapping: ImportMapping
    ) -> Iterator[CanonicalBatch]: ...

    async def stream_batches(
        self, config: StreamConfig
    ) -> AsyncIterator[CanonicalBatch]: ...

    async def command(self, command: AdapterCommand) -> CommandResult: ...


def unsupported(capability: AdapterCapability) -> UnsupportedCapabilityResult:
    """Build the stable result used by adapters for an unavailable capability."""

    return UnsupportedCapabilityResult(
        capability=capability,
        message=f"Adapter does not support {capability.value}",
    )
