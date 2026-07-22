"""Capability-safe mapping parsing for authenticated QEC engine imports."""

from __future__ import annotations

from .adapters.base import ImportMapping, ScalarValue
from .protocol import ProtocolError


SECONDARY_STIM_CONTEXT_OPTIONS = frozenset({"circuit_path", "dem_path"})
REQUIRED_STIM_WIDTH_OPTIONS = frozenset({"detector_count", "observable_count"})


def engine_import_mapping(
    value: object,
    *,
    adapter_id: str,
    session_id: str | None = None,
) -> ImportMapping:
    if type(value) is not dict:
        raise ProtocolError("invalid_request", "Import mapping must be an object.")
    allowed = frozenset({"fields", "options", "expectedProvenanceId"})
    if not frozenset(value) <= allowed:
        raise ProtocolError("invalid_request", "Import mapping fields are invalid.")
    fields = value.get("fields", {})
    options = value.get("options", {})
    if type(fields) is not dict or type(options) is not dict:
        raise ProtocolError(
            "invalid_request", "Import mapping entries must be objects."
        )
    if not all(type(key) is str and type(item) is str for key, item in fields.items()):
        raise ProtocolError("invalid_request", "Import field mapping is invalid.")
    if not all(type(key) is str for key in options):
        raise ProtocolError("invalid_request", "Import option names are invalid.")
    frozen_options: dict[str, ScalarValue] = {
        str(key): _freeze_scalar(item) for key, item in options.items()
    }
    _require_capability_backed_options(frozen_options, adapter_id)
    if session_id is not None:
        frozen_options = {
            **frozen_options,
            "session_id": session_id,
            "segment_id": "segment-0001",
        }
    expected = value.get("expectedProvenanceId")
    return ImportMapping(
        fields=tuple(sorted(fields.items())),
        options=tuple(sorted(frozen_options.items())),
        expected_provenance_id=expected,
    )


def _require_capability_backed_options(
    options: dict[str, ScalarValue], adapter_id: str
) -> None:
    option_names = set(options)
    if SECONDARY_STIM_CONTEXT_OPTIONS & option_names:
        raise ProtocolError(
            "invalid_request",
            "Stim circuit/DEM context options are not capability-backed by the "
            "QEC Data Engine. Provide detector_count and observable_count explicitly.",
        )
    if adapter_id == "stim-results" and not REQUIRED_STIM_WIDTH_OPTIONS <= option_names:
        raise ProtocolError(
            "invalid_request",
            "Stim engine imports require explicit detector_count and observable_count.",
        )


def _freeze_scalar(value: object) -> ScalarValue:
    if type(value) is list:
        return tuple(_freeze_scalar(item) for item in value)
    if value is None or type(value) in {str, bool, int, float}:
        return value
    raise ProtocolError("invalid_request", "Import option is not scalar JSON.")
