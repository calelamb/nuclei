"""Immutable in-process registry for QEC data adapters."""

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
    """An adapter cannot be represented safely in the registry."""


@dataclass(frozen=True, slots=True)
class AdapterRegistry:
    adapters: tuple[QecDataAdapter, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.adapters, tuple):
            raise TypeError("registered adapters must be an immutable tuple")
        for adapter in self.adapters:
            _validate_adapter(adapter)
        identities = tuple(_identity(adapter) for adapter in self.adapters)
        if len(identities) != len(set(identities)):
            raise AdapterRegistrationError("adapter id/version is already registered")

    def register(self, adapter: QecDataAdapter) -> AdapterRegistry:
        _validate_adapter(adapter)
        identity = _identity(adapter)
        if any(_identity(current) == identity for current in self.adapters):
            raise AdapterRegistrationError(
                f"adapter {identity[0]} version {identity[1]} is already registered"
            )
        return AdapterRegistry(adapters=(*self.adapters, adapter))

    def get(self, adapter_id: str, version: str | None = None) -> QecDataAdapter:
        matches = tuple(
            adapter
            for adapter in self.adapters
            if adapter.manifest.id == adapter_id
            and (version is None or adapter.manifest.version == version)
        )
        if not matches:
            raise KeyError(f"adapter {adapter_id!r} is not registered")
        if len(matches) > 1:
            raise KeyError(f"adapter {adapter_id!r} requires an explicit version")
        return matches[0]


def _identity(adapter: object) -> tuple[str, str]:
    manifest = getattr(adapter, "manifest", None)
    if not isinstance(manifest, AdapterManifest):
        raise AdapterRegistrationError("adapter manifest is invalid")
    try:
        validated = AdapterManifest(
            id=manifest.id,
            version=manifest.version,
            capabilities=manifest.capabilities,
            source_kinds=manifest.source_kinds,
        )
    except (AttributeError, TypeError, ValueError) as error:
        raise AdapterRegistrationError(
            f"adapter manifest is invalid: {error}"
        ) from error
    return validated.id, validated.version


def _validate_adapter(adapter: object) -> None:
    _identity(adapter)
    missing = tuple(
        name for name in REQUIRED_METHODS if not callable(getattr(adapter, name, None))
    )
    if missing:
        raise AdapterRegistrationError(
            f"adapter is missing required methods: {', '.join(missing)}"
        )
