"""Complete static SQL templates for each allowlisted syndrome table profile."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType


TABLE_BASE_FIRST = """
SELECT sequence, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_BASE_AFTER = """
SELECT sequence, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ? AND sequence > ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_TIMESTAMP_FIRST = """
SELECT sequence, timestamp_ns, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_TIMESTAMP_AFTER = """
SELECT sequence, timestamp_ns, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ? AND sequence > ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_ROUND_FIRST = """
SELECT sequence, round, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_ROUND_AFTER = """
SELECT sequence, round, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ? AND sequence > ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_TIMESTAMP_ROUND_FIRST = """
SELECT sequence, timestamp_ns, round, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_TIMESTAMP_ROUND_AFTER = """
SELECT sequence, timestamp_ns, round, detectors
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ? AND sequence > ?
ORDER BY sequence ASC
LIMIT ?
"""

_PROFILE_TEMPLATES = (
    ("base", False, TABLE_BASE_FIRST),
    ("base", True, TABLE_BASE_AFTER),
    ("timestamp", False, TABLE_TIMESTAMP_FIRST),
    ("timestamp", True, TABLE_TIMESTAMP_AFTER),
    ("round", False, TABLE_ROUND_FIRST),
    ("round", True, TABLE_ROUND_AFTER),
    ("timestamp-round", False, TABLE_TIMESTAMP_ROUND_FIRST),
    ("timestamp-round", True, TABLE_TIMESTAMP_ROUND_AFTER),
)

TABLE_TEMPLATES: Mapping[tuple[str, str, str, bool], str] = MappingProxyType(
    {
        (tile, "rows", profile, after): template
        for tile in ("table-page", "shot-window")
        for profile, after, template in _PROFILE_TEMPLATES
    }
)
