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
TABLE_CAMPAIGN_FIRST = """
SELECT sequence, shots, errors, discards, seconds, decoder, strong_id,
       json_metadata, custom_counts
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_CAMPAIGN_AFTER = """
SELECT sequence, shots, errors, discards, seconds, decoder, strong_id,
       json_metadata, custom_counts
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ? AND sequence > ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_CALIBRATION_FIRST = """
SELECT sequence, calibration_id, session_id, scope_kind, scope_id,
       parameter_name, semantic_id, value, value_status, unit, unit_status,
       uncertainty, uncertainty_status, quality, source_system, provenance_id,
       effective_start, effective_end, calibration_run_id, original_mime_type,
       original_representation, record_schema_version
FROM read_parquet(?, union_by_name = false)
WHERE sequence >= ? AND sequence <= ?
ORDER BY sequence ASC
LIMIT ?
"""
TABLE_CALIBRATION_AFTER = """
SELECT sequence, calibration_id, session_id, scope_kind, scope_id,
       parameter_name, semantic_id, value, value_status, unit, unit_status,
       uncertainty, uncertainty_status, quality, source_system, provenance_id,
       effective_start, effective_end, calibration_run_id, original_mime_type,
       original_representation, record_schema_version
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
    ("campaign-points-v1", False, TABLE_CAMPAIGN_FIRST),
    ("campaign-points-v1", True, TABLE_CAMPAIGN_AFTER),
    ("calibrations-v1", False, TABLE_CALIBRATION_FIRST),
    ("calibrations-v1", True, TABLE_CALIBRATION_AFTER),
)

TABLE_TEMPLATES: Mapping[tuple[str, str, str, bool], str] = MappingProxyType(
    {
        (tile, "rows", profile, after): template
        for tile in ("table-page", "shot-window")
        for profile, after, template in _PROFILE_TEMPLATES
    }
)
