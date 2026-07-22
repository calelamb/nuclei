"""Deterministic hashes for QEC scientific identities and materialized files."""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TypeAlias


CanonicalValue: TypeAlias = (
    None
    | bool
    | int
    | float
    | str
    | list["CanonicalValue"]
    | dict[str, "CanonicalValue"]
)
DATASET_DOMAIN = b"nuclei:qec-dataset:v1\0"


def sha256_file(path: Path) -> str:
    """Hash a file without loading it into memory."""

    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _canonical_number(value: int | float) -> int | float:
    if isinstance(value, int):
        return value
    if not math.isfinite(value):
        raise ValueError("canonical numbers must be finite")
    if value == 0:
        return 0
    if value.is_integer():
        return int(value)
    return value


def _canonical_mapping(value: Mapping[object, object]) -> dict[str, CanonicalValue]:
    result: dict[str, CanonicalValue] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise TypeError("canonical object keys must be strings")
        normalized_key = unicodedata.normalize("NFC", key)
        if normalized_key in result:
            raise ValueError("canonical object has duplicate NFC-normalized keys")
        result[normalized_key] = normalize_canonical_value(item)
    return result


def normalize_canonical_value(value: object) -> CanonicalValue:
    """Normalize supported JSON values before hashing."""

    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return _canonical_number(value)
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, Mapping):
        return _canonical_mapping(value)
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [normalize_canonical_value(item) for item in value]
    raise TypeError(f"unsupported canonical value: {type(value).__name__}")


def canonical_json_bytes(value: object) -> bytes:
    """Encode normalized semantic data in one stable JSON representation."""

    normalized = normalize_canonical_value(value)
    return json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def semantic_digest(domain: bytes, value: object) -> str:
    """Hash canonical semantic content under an explicit domain separator."""

    if not domain or not domain.endswith(b"\0"):
        raise ValueError("hash domain must be non-empty and NUL-terminated")
    return hashlib.sha256(domain + canonical_json_bytes(value)).hexdigest()


def is_sha256(value: object) -> bool:
    """Return whether a value is canonical lowercase SHA-256 hex."""

    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def require_exact_keys(
    value: Mapping[object, object], keys: frozenset[str], name: str
) -> None:
    """Reject missing or unknown fields at a durable JSON boundary."""

    actual = frozenset(value.keys())
    if actual != keys:
        raise ValueError(
            f"{name} fields differ: missing={keys - actual}, extra={actual - keys}"
        )


def _validate_digest(value: str) -> None:
    if not is_sha256(value):
        raise ValueError("parent dataset ID must be a lowercase SHA-256 digest")


def dataset_id(
    *,
    schema_version: str,
    parent_dataset_ids: tuple[str, ...],
    recipe_id: str,
    recipe_version: str,
    parameters: Mapping[str, object],
) -> str:
    """Return an ID from semantic inputs, independent of paths and Parquet bytes."""

    if (
        not schema_version.strip()
        or not recipe_id.strip()
        or not recipe_version.strip()
    ):
        raise ValueError("dataset identity strings must be non-empty")
    if len(set(parent_dataset_ids)) != len(parent_dataset_ids):
        raise ValueError("parent dataset IDs must be unique")
    for parent_id in parent_dataset_ids:
        _validate_digest(parent_id)
    identity = {
        "schema_version": schema_version,
        "parent_dataset_ids": sorted(parent_dataset_ids),
        "recipe": {"id": recipe_id, "version": recipe_version},
        "parameters": parameters,
    }
    return semantic_digest(DATASET_DOMAIN, identity)
