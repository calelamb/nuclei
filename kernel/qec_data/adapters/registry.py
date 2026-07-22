"""Immutable, capability-stable registry for QEC data adapters."""

from __future__ import annotations

from dataclasses import dataclass

from .base import AdapterManifest, QecDataAdapter


REQUIRED_METHODS = (
    "probe",
    "validate",
    "preview",
    "import_batches",
    "stream_batches",
    "command",
)


class AdapterRegistrationError(ValueError):
    """An adapter cannot be represented or dispatched safely."""


@dataclass(frozen=True, slots=True)
class RegistrationRecord:
    """Public immutable registration metadata without an adapter escape hatch."""

    manifest: AdapterManifest

    @property
    def key(self) -> tuple[str, str]:
        return self.manifest.id, self.manifest.version


@dataclass(frozen=True, slots=True)
class _RegistrationEntry:
    record: RegistrationRecord
    adapter: QecDataAdapter

    @property
    def key(self) -> tuple[str, str]:
        return self.record.key

    def resolve(self) -> QecDataAdapter:
        live = _snapshot_manifest(self.adapter)
        if live != self.record.manifest:
            raise AdapterRegistrationError(
                f"adapter manifest changed after registration: {self.key}"
            )
        _validate_methods(self.adapter)
        return self.adapter


@dataclass(frozen=True, slots=True)
class AdapterRegistry:
    _entries: tuple[_RegistrationEntry, ...] = ()

    def __post_init__(self) -> None:
        if type(self._entries) is not tuple:
            raise TypeError("adapter entries must be an immutable tuple")
        if not all(type(item) is _RegistrationEntry for item in self._entries):
            raise AdapterRegistrationError("adapter registration record is invalid")
        keys = tuple(entry.key for entry in self._entries)
        if len(keys) != len(set(keys)):
            raise AdapterRegistrationError("adapter id/version is already registered")

    @property
    def registrations(self) -> tuple[RegistrationRecord, ...]:
        return tuple(entry.record for entry in self._entries)

    def register(self, adapter: QecDataAdapter) -> AdapterRegistry:
        manifest = _snapshot_manifest(adapter)
        _validate_methods(adapter)
        record = RegistrationRecord(manifest=manifest)
        if any(current.key == record.key for current in self._entries):
            raise AdapterRegistrationError(
                f"adapter {record.key[0]} version {record.key[1]} is already registered"
            )
        entry = _RegistrationEntry(record=record, adapter=adapter)
        return AdapterRegistry(_entries=(*self._entries, entry))

    def get(self, adapter_id: str, version: str | None = None) -> QecDataAdapter:
        matches = tuple(
            entry
            for entry in self._entries
            if entry.record.manifest.id == adapter_id
            and (version is None or entry.record.manifest.version == version)
        )
        if not matches:
            raise KeyError(f"adapter {adapter_id!r} is not registered")
        if len(matches) > 1:
            raise KeyError(f"adapter {adapter_id!r} requires an explicit version")
        return matches[0].resolve()


def _snapshot_manifest(adapter: object) -> AdapterManifest:
    try:
        manifest = getattr(adapter, "manifest")
        return AdapterManifest(
            id=manifest.id,
            version=manifest.version,
            capabilities=manifest.capabilities,
            source_kinds=manifest.source_kinds,
            output_kinds=manifest.output_kinds,
        )
    except (AttributeError, TypeError, ValueError) as error:
        raise AdapterRegistrationError(
            f"adapter manifest is invalid: {error}"
        ) from error


def _validate_methods(adapter: object) -> None:
    missing = tuple(
        name for name in REQUIRED_METHODS if not callable(getattr(adapter, name, None))
    )
    if missing:
        raise AdapterRegistrationError(
            f"adapter is missing required methods: {', '.join(missing)}"
        )
