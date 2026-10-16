"""Run manifests: everything needed to judge or reproduce a number."""

from __future__ import annotations

import platform
from importlib import metadata
from typing import Any, Mapping

from . import __version__

_TRACKED_PACKAGES = ("stim", "sinter", "pymatching", "fusion-blossom", "numpy", "scipy", "mcp")

# Units are part of the contract: a bare rate without units is how numbers
# get misread.
UNITS = {
    "shots": "count",
    "errors": "count (logical errors among kept shots)",
    "discards": "count (post-selected shots removed)",
    "seconds": "s (cumulative CPU/worker time as reported by sinter)",
    "per_shot_rate": "probability that a kept shot has a logical error (dimensionless)",
    "per_round_rate": "logical error probability per QEC round (dimensionless)",
    "lambda": "error suppression factor per +2 code distance (dimensionless)",
}


def package_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for name in _TRACKED_PACKAGES:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def build_manifest(
    *,
    tool: str,
    parameters: Mapping[str, Any],
    estimator: str = "none",
    ci_method: str = "none",
    circuit_sha256: list[str] | None = None,
    units: Mapping[str, str] | None = None,
    notes: list[str] | None = None,
    reproducible: bool = True,
) -> dict[str, Any]:
    return {
        "tool": tool,
        "nuclei_mcp_version": __version__,
        "python": platform.python_version(),
        "versions": package_versions(),
        "circuit_sha256": sorted(circuit_sha256 or []),
        "parameters": dict(parameters),
        "estimator": estimator,
        "ci_method": ci_method,
        "units": dict(units or {}),
        "deterministically_reproducible": reproducible,
        "notes": list(notes or []),
    }
