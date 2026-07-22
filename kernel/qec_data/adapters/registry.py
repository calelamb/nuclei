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
    """Frozen registration identity independent of mutable adapter attributes."""

    manifest: AdapterManifest
    adapter: QecDataAdapter

    @property
    def key(self) -> tuple[str, str]:
        return self.manifest.id, self.manifest.version

    def resolve(self) -> QecDataAdapter:
        live = _snapshot_manifest(self.adapter)
        if live != self.manifest:
            raise AdapterRegistrationError(
                f"adapter manifest changed after registration: {self.key}"
            )
        _validate_methods(self.adapter)
        return self.adapter


@dataclass(frozen=True, slots=True)
class AdapterRegistry:
    registrations: tuple[RegistrationRecord, ...] = ()

    def __post_init__(self) -> None:
        if type(self.registrations) is not tuple:
            raise TypeError("adapter registrations must be an immutable tuple")
        if not all(type(item) is RegistrationRecord for item in self.registrations):
            raise AdapterRegistrationError("adapter registration record is invalid")
        keys = tuple(record.key for record in self.registrations)
        if len(keys) != len(set(keys)):
            raise AdapterRegistrationError("adapter id/version is already registered")

    @property
    def adapters(self) -> tuple[QecDataAdapter, ...]:
        return tuple(record.adapter for record in self.registrations)

    def register(self, adapter: QecDataAdapter) -> AdapterRegistry:
        manifest = _snapshot_manifest(adapter)
        _validate_methods(adapter)
        record = RegistrationRecord(manifest=manifest, adapter=adapter)
        if any(current.key == record.key for current in self.registrations):
            raise AdapterRegistrationError(
                f"adapter {record.key[0]} version {record.key[1]} is already registered"
            )
        return AdapterRegistry(registrations=(*self.registrations, record))

    def get(self, adapter_id: str, version: str | None = None) -> QecDataAdapter:
        matches = tuple(
            record
            for record in self.registrations
            if record.manifest.id == adapter_id
            and (version is None or record.manifest.version == version)
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
