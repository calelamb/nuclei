"""Strict immutable JSON documents used by canonical aggregate records."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence

from .hashing import canonical_json_bytes


MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991
MAX_CANONICAL_JSON_BYTES = 65_536
MAX_CANONICAL_JSON_DEPTH = 32
MAX_CANONICAL_JSON_KEYS = 4_096
MAX_CANONICAL_JSON_CONTAINER_ITEMS = 4_096


def _reject_constant(value: str) -> None:
    raise ValueError(f"canonical JSON values must be finite: {value}")


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"canonical JSON values must be finite: {value}")
    return parsed


def _require_document_string_bound(value: str) -> None:
    if len(value) > MAX_CANONICAL_JSON_BYTES - 2:
        raise ValueError("canonical JSON document exceeds 64 KiB")


def _require_structure_bounds(*, keys: int, items: int, depth: int) -> None:
    if depth > MAX_CANONICAL_JSON_DEPTH:
        raise ValueError("canonical JSON exceeds maximum depth")
    if keys > MAX_CANONICAL_JSON_KEYS:
        raise ValueError("canonical JSON exceeds maximum keys")
    if items > MAX_CANONICAL_JSON_CONTAINER_ITEMS:
        raise ValueError("canonical JSON exceeds maximum container items")


def _validate_value(value: object) -> None:
    stack: list[tuple[object, int]] = [(value, 0)]
    keys = 0
    items = 0
    while stack:
        current, depth = stack.pop()
        if isinstance(current, str):
            _require_document_string_bound(current)
            continue
        if type(current) is int and abs(current) > MAX_SAFE_JSON_INTEGER:
            raise ValueError("canonical JSON integers must be JavaScript-safe")
        if isinstance(current, Mapping):
            keys += len(current)
            items += len(current)
            _require_structure_bounds(keys=keys, items=items, depth=depth + 1)
            for key, item in current.items():
                if isinstance(key, str):
                    _require_document_string_bound(key)
                stack.append((item, depth + 1))
        elif isinstance(current, Sequence) and not isinstance(current, (str, bytes)):
            items += len(current)
            _require_structure_bounds(keys=keys, items=items, depth=depth + 1)
            stack.extend((item, depth + 1) for item in current)


def _scan_document_structure(document: str) -> None:
    depth = 0
    commas = 0
    colons = 0
    nonempty_containers = 0
    containers: list[bool] = []
    in_string = False
    escaped = False
    for character in document:
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
            if containers:
                containers[-1] = True
        elif character in "[{":
            if containers:
                containers[-1] = True
            containers.append(False)
            depth += 1
            if depth > MAX_CANONICAL_JSON_DEPTH:
                raise ValueError("canonical JSON exceeds maximum depth")
        elif character in "]}":
            if containers and containers.pop():
                nonempty_containers += 1
            depth -= 1
        elif character == ",":
            commas += 1
            if commas + nonempty_containers >= MAX_CANONICAL_JSON_CONTAINER_ITEMS:
                raise ValueError("canonical JSON exceeds maximum container items")
        elif character == ":":
            colons += 1
            if colons > MAX_CANONICAL_JSON_KEYS:
                raise ValueError("canonical JSON exceeds maximum keys")
        elif not character.isspace() and containers:
            containers[-1] = True
    if commas + nonempty_containers > MAX_CANONICAL_JSON_CONTAINER_ITEMS:
        raise ValueError("canonical JSON exceeds maximum container items")


def _preflight_document(document: str) -> None:
    if len(document) > MAX_CANONICAL_JSON_BYTES:
        raise ValueError("canonical JSON document exceeds 64 KiB")
    if len(document.encode("utf-8")) > MAX_CANONICAL_JSON_BYTES:
        raise ValueError("canonical JSON document exceeds 64 KiB")
    _scan_document_structure(document)


def _object_hook():
    key_count = 0

    def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        nonlocal key_count
        key_count += len(pairs)
        if key_count > MAX_CANONICAL_JSON_KEYS:
            raise ValueError("canonical JSON exceeds maximum keys")
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON object key is forbidden: {key}")
            result[key] = value
        return result

    return unique_object


def canonical_json_document(value: object) -> str:
    """Return one stable JSON string after enforcing cross-runtime safe values."""

    _validate_value(value)
    document = canonical_json_bytes(value).decode("utf-8")
    _preflight_document(document)
    return document


def parse_canonical_json_document(name: str, document: str) -> object:
    if type(document) is not str:
        raise TypeError(f"{name} must be a canonical JSON string")
    _preflight_document(document)
    try:
        value = json.loads(
            document,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
            object_pairs_hook=_object_hook(),
        )
    except json.JSONDecodeError as error:
        raise ValueError(f"{name} must contain valid JSON") from error
    _validate_value(value)
    if canonical_json_document(value) != document:
        raise ValueError(f"{name} must use the canonical JSON representation")
    return value


def validate_canonical_json_document(name: str, document: str) -> None:
    parse_canonical_json_document(name, document)
