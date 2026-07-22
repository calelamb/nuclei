"""Deterministic hashes for QEC scientific identities and materialized files."""

from __future__ import annotations

import hashlib
import json
import math
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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
PACKED_SEMANTIC_KEYS = frozenset(
    {"detectors", "observables", "measurements", "erasures", "leakage", "heralds"}
)
MAPPING_SEMANTIC_KEYS = PACKED_SEMANTIC_KEYS | frozenset(
    {"sequence", "timestamp", "round"}
)
CAMPAIGN_SEMANTIC_KEYS = frozenset(
    {
        "shots",
        "errors",
        "discards",
        "seconds",
        "decoder",
        "strong_id",
        "json_metadata",
        "custom_counts",
    }
)
CALIBRATION_SEMANTIC_KEYS = frozenset(
    {
        "calibration_id",
        "session_id",
        "scope_kind",
        "scope_id",
        "parameter_name",
        "semantic_id",
        "value",
        "unit",
        "uncertainty",
        "quality",
        "source_system",
        "provenance_id",
        "effective_start",
        "effective_end",
        "calibration_run_id",
        "original_mime_type",
        "original_representation",
    }
)
TYPED_SEMANTIC_KEYS = CAMPAIGN_SEMANTIC_KEYS | CALIBRATION_SEMANTIC_KEYS
MAPPING_SEMANTIC_KEYS |= TYPED_SEMANTIC_KEYS
UNIT_SEMANTIC_KEYS = frozenset(
    {"timestamp", "round", "time", "seconds", "value", "uncertainty"}
)


def _require_pair_tuple(name: str, value: object) -> tuple[tuple[str, object], ...]:
    if not isinstance(value, tuple) or any(
        not isinstance(item, tuple) or len(item) != 2 for item in value
    ):
        raise TypeError(f"{name} must be an immutable tuple of pairs")
    pairs = value
    if len({item[0] for item in pairs}) != len(pairs):
        raise ValueError(f"{name} keys must be unique")
    return pairs


def _validate_semantic_pairs(
    name: str,
    pairs: tuple[tuple[str, object], ...],
    allowed_keys: frozenset[str],
    value_type: type,
    *,
    allow_empty: bool = False,
) -> None:
    if not pairs and not allow_empty:
        raise ValueError(f"{name} must not be empty")
    for key, value in pairs:
        if key not in allowed_keys:
            raise ValueError(f"{name} key is not a canonical QEC field: {key}")
        if type(value) is not value_type:
            raise TypeError(f"{name} values must be {value_type.__name__}")
        if value_type is str and not str(value).strip():
            raise ValueError(f"{name} string values must not be blank")
        if value_type is int and int(value) < 1:
            raise ValueError(f"{name} bit widths must be positive")


@dataclass(frozen=True, slots=True)
class DatasetSemanticIdentity:
    """Canonical scientific inputs used to identify one raw QEC dataset."""

    source_sha256: tuple[str, ...]
    adapter_id: str
    adapter_version: str
    mapping: tuple[tuple[str, str], ...]
    bit_widths: tuple[tuple[str, int], ...]
    units: tuple[tuple[str, str], ...]
    time_domain: str

    def __post_init__(self) -> None:
        if not isinstance(self.source_sha256, tuple) or not self.source_sha256:
            raise ValueError("source SHA-256 identities must be a non-empty tuple")
        if not all(isinstance(value, str) for value in self.source_sha256):
            raise TypeError("source SHA-256 identities must be strings")
        if len(set(self.source_sha256)) != len(self.source_sha256):
            raise ValueError("source SHA-256 identities must be unique")
        for source_hash in self.source_sha256:
            if not is_sha256(source_hash):
                raise ValueError("source identity must be a lowercase SHA-256 digest")
        if not isinstance(self.adapter_id, str) or not isinstance(
            self.adapter_version, str
        ):
            raise TypeError("adapter identity must use strings")
        if not self.adapter_id.strip() or not self.adapter_version.strip():
            raise ValueError("adapter identity must not be blank")
        mapping = _require_pair_tuple("mapping", self.mapping)
        _validate_semantic_pairs(
            "mapping",
            mapping,
            MAPPING_SEMANTIC_KEYS,
            str,
        )
        typed_mapping = bool({key for key, _ in mapping} & TYPED_SEMANTIC_KEYS)
        _validate_semantic_pairs(
            "bit_widths",
            _require_pair_tuple("bit_widths", self.bit_widths),
            PACKED_SEMANTIC_KEYS,
            int,
            allow_empty=typed_mapping,
        )
        _validate_semantic_pairs(
            "units",
            _require_pair_tuple("units", self.units),
            UNIT_SEMANTIC_KEYS,
            str,
            allow_empty=typed_mapping,
        )
        if not isinstance(self.time_domain, str):
            raise TypeError("time domain must be a string")
        if self.time_domain not in {"tick", "round", "timestamp", "custom"}:
            raise ValueError("time domain is invalid")

    def to_mapping(self) -> dict[str, object]:
        return {
            "source_sha256": sorted(self.source_sha256),
            "adapter": {"id": self.adapter_id, "version": self.adapter_version},
            "mapping": dict(self.mapping),
            "bit_widths": dict(self.bit_widths),
            "units": dict(self.units),
            "time_domain": self.time_domain,
        }

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> DatasetSemanticIdentity:
        if not isinstance(value, Mapping):
            raise TypeError("dataset semantic identity must be an object")
        required = frozenset(
            {
                "source_sha256",
                "adapter",
                "mapping",
                "bit_widths",
                "units",
                "time_domain",
            }
        )
        require_exact_keys(value, required, "dataset semantic identity")
        adapter = value["adapter"]
        if not isinstance(adapter, Mapping):
            raise TypeError("dataset adapter must be an object")
        require_exact_keys(adapter, frozenset({"id", "version"}), "dataset adapter")
        return cls(
            source_sha256=_string_tuple(value["source_sha256"], "source_sha256"),
            adapter_id=_string(adapter["id"], "adapter.id"),
            adapter_version=_string(adapter["version"], "adapter.version"),
            mapping=_mapping_pairs(value["mapping"], "mapping", str),
            bit_widths=_mapping_pairs(value["bit_widths"], "bit_widths", int),
            units=_mapping_pairs(value["units"], "units", str),
            time_domain=_string(value["time_domain"], "time_domain"),
        )


def _string(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value


def _string_tuple(value: object, name: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise TypeError(f"{name} must be an array of strings")
    return tuple(value)


def _mapping_pairs(
    value: object, name: str, value_type: type
) -> tuple[tuple[str, object], ...]:
    if not isinstance(value, Mapping) or not all(
        isinstance(key, str) and type(item) is value_type for key, item in value.items()
    ):
        raise TypeError(f"{name} must be a canonical object")
    return tuple(sorted(value.items()))


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
