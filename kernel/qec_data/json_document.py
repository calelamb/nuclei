"""Strict immutable JSON documents used by canonical aggregate records."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence

from .hashing import canonical_json_bytes


MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991


def _reject_constant(value: str) -> None:
    raise ValueError(f"canonical JSON values must be finite: {value}")


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"canonical JSON values must be finite: {value}")
    return parsed


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key is forbidden: {key}")
        result[key] = value
    return result


def _require_safe_integers(value: object) -> None:
    if type(value) is int and abs(value) > MAX_SAFE_JSON_INTEGER:
        raise ValueError("canonical JSON integers must be JavaScript-safe")
    if isinstance(value, Mapping):
        for item in value.values():
            _require_safe_integers(item)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for item in value:
            _require_safe_integers(item)


def canonical_json_document(value: object) -> str:
    """Return one stable JSON string after enforcing cross-runtime safe values."""

    _require_safe_integers(value)
    return canonical_json_bytes(value).decode("utf-8")


def parse_canonical_json_document(name: str, document: str) -> object:
    if type(document) is not str:
        raise TypeError(f"{name} must be a canonical JSON string")
    try:
        value = json.loads(
            document,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
            object_pairs_hook=_unique_object,
        )
    except json.JSONDecodeError as error:
        raise ValueError(f"{name} must contain valid JSON") from error
    _require_safe_integers(value)
    if canonical_json_document(value) != document:
        raise ValueError(f"{name} must use the canonical JSON representation")
    return value


def validate_canonical_json_document(name: str, document: str) -> None:
    parse_canonical_json_document(name, document)
