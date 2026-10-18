"""Trainability certificate provenance (PRD 14 addendum section D)."""

from __future__ import annotations

import hashlib
import platform
from datetime import datetime, timezone
from functools import lru_cache
from importlib import metadata
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = "1.3"
_PACKAGE_DIR = Path(__file__).resolve().parent
_DISTRIBUTIONS: dict[str, tuple[str, ...]] = {
    "numpy": ("numpy",),
    "stim": ("stim",),
    "qiskit": ("qiskit",),
    "cirq": ("cirq-core", "cirq"),
}

__all__ = [
    "PROTOCOL_VERSION",
    "analyses_fingerprint",
    "build_provenance",
    "code_sha256",
    "kernel_versions",
]


def code_sha256(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def analyses_fingerprint() -> str:
    """sha256 over the bytes of ``kernel/trainability/*.py`` in sorted path order."""
    digest = hashlib.sha256()
    for path in sorted(_PACKAGE_DIR.glob("*.py")):
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _version(names: tuple[str, ...]) -> str | None:
    for name in names:
        try:
            return metadata.version(name)
        except metadata.PackageNotFoundError:
            continue
    return None


@lru_cache(maxsize=1)
def _versions() -> tuple[tuple[str, str | None], ...]:
    return tuple((key, _version(names)) for key, names in _DISTRIBUTIONS.items())


def kernel_versions() -> dict[str, Any]:
    return {
        "nuclei_protocol": PROTOCOL_VERSION,
        "python": platform.python_version(),
        **dict(_versions()),
    }


def build_provenance(
    *,
    code: str,
    observable: str,
    settings: dict[str, Any],
    backend: str,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    stamp = (created_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return {
        "code_sha256": code_sha256(code),
        "observable": observable,
        "settings": settings,
        "kernel": kernel_versions(),
        "analyses_fingerprint": analyses_fingerprint(),
        "backend": backend,
        "created_at": stamp.isoformat().replace("+00:00", "Z"),
    }
