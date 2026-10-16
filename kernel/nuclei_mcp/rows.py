"""Stat rows (sinter TaskStats-shaped) and grouping/aggregation helpers."""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from pydantic import BaseModel, ConfigDict, Field

from .errors import ToolInputError
from .journal import canonical_json


class StatRow(BaseModel):
    """Boundary schema for a stats row (matches sinter's CSV columns)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    shots: int = Field(ge=0)
    errors: int = Field(ge=0)
    discards: int = Field(0, ge=0)
    seconds: float = Field(0.0, ge=0)
    decoder: str = ""
    strong_id: str = ""
    json_metadata: dict[str, Any] = Field(default_factory=dict)
    custom_counts: dict[str, int] = Field(default_factory=dict)


def stats_to_rows(stats: Iterable[Any]) -> list[dict[str, Any]]:
    """sinter.TaskStats -> plain row dicts (JSON-safe)."""
    return [
        {
            "shots": int(s.shots),
            "errors": int(s.errors),
            "discards": int(s.discards),
            "seconds": float(s.seconds),
            "decoder": s.decoder,
            "strong_id": s.strong_id,
            "json_metadata": s.json_metadata if s.json_metadata is not None else {},
            "custom_counts": {k: int(v) for k, v in dict(s.custom_counts).items()},
        }
        for s in stats
    ]


def row_value(row: Mapping[str, Any], key: str, index: int) -> Any:
    """Look ``key`` up in json_metadata first, then top-level decoder/strong_id."""
    meta = row.get("json_metadata")
    if isinstance(meta, dict) and key in meta:
        return meta[key]
    if key in ("decoder", "strong_id") and row.get(key):
        return row[key]
    raise ToolInputError(
        f"row {index} (strong_id={row.get('strong_id', '')!r}) has no key {key!r} in json_metadata"
    )


def validated_rows(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for i, row in enumerate(rows):
        try:
            out.append(StatRow.model_validate(dict(row)).model_dump())
        except Exception as exc:  # pydantic ValidationError -> user-readable
            raise ToolInputError(f"rows[{i}] is invalid: {exc}") from exc
    return out


def group_key(values: Mapping[str, Any]) -> str:
    return canonical_json(dict(values))


def sum_counts(rows: list[Mapping[str, Any]]) -> dict[str, int]:
    return {
        "shots": sum(r["shots"] for r in rows),
        "errors": sum(r["errors"] for r in rows),
        "discards": sum(r["discards"] for r in rows),
    }


_MISSING = object()


def mixed_metadata_keys(rows: list[Mapping[str, Any]], pinned: Iterable[str]) -> dict[str, list[Any]]:
    """Keys (outside ``pinned``) on which the rows disagree, with the distinct values.

    Pooling rows that differ on, say, physical error rate or decoder yields a
    number that describes no single experiment, so callers refuse on this.
    The top-level ``decoder`` is checked as well as json_metadata.
    """
    skip = set(pinned)
    keys: set[str] = set()
    for row in rows:
        keys.update((row.get("json_metadata") or {}).keys())
    keys.add("decoder")
    keys -= skip
    mixed: dict[str, list[Any]] = {}
    for key in sorted(keys):
        seen: dict[str, Any] = {}
        for row in rows:
            meta = row.get("json_metadata") or {}
            value = meta[key] if key in meta else (row.get(key) if key == "decoder" else _MISSING)
            seen.setdefault(canonical_json(None if value is _MISSING else {"v": value}), None if value is _MISSING else value)
        if len(seen) > 1:
            mixed[key] = list(seen.values())
    return mixed

