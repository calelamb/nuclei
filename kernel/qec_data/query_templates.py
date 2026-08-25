"""Static aggregate and table SQL allowlist for QEC visualization queries."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType

from .query_table_templates import TABLE_TEMPLATES


SYNDROME_PROFILES = frozenset({"base", "timestamp", "round", "timestamp-round"})
SCHEMA_PROFILES = SYNDROME_PROFILES | frozenset(
    {"campaign-points-v1", "calibrations-v1"}
)
TIME_SERIES_DETECTOR_WEIGHT = """
WITH filtered AS (
  SELECT sequence, bit_count(CAST(detectors AS BIT))::DOUBLE AS value
  FROM read_parquet(?, union_by_name = false)
  WHERE sequence >= ? AND sequence <= ?
), binned AS (
  SELECT LEAST(? - 1, FLOOR((sequence - ?)::DOUBLE * ? / ?)::INTEGER) AS bin,
         value
  FROM filtered
)
SELECT bin, min(value) AS minimum, max(value) AS maximum,
       avg(value) AS mean, count(*)::UBIGINT AS sample_count
FROM binned
GROUP BY bin
ORDER BY bin
"""
HISTOGRAM_DETECTOR_WEIGHT = """
WITH filtered AS (
  SELECT bit_count(CAST(detectors AS BIT))::DOUBLE AS value
  FROM read_parquet(?, union_by_name = false)
  WHERE sequence >= ? AND sequence <= ?
), bounds AS (
  SELECT min(value) AS minimum, max(value) AS maximum FROM filtered
), binned AS (
  SELECT CASE WHEN maximum = minimum THEN 0 ELSE
    LEAST(? - 1, FLOOR((value - minimum) * ? / (maximum - minimum))::INTEGER)
  END AS bin, value, minimum, maximum
  FROM filtered CROSS JOIN bounds
)
SELECT bin, min(minimum) AS lower_bound, max(maximum) AS upper_bound,
       count(*)::UBIGINT AS sample_count
FROM binned
GROUP BY bin
ORDER BY bin
"""
HEATMAP_DETECTOR_EVENTS = """
WITH filtered AS (
  SELECT sequence, detectors
  FROM read_parquet(?, union_by_name = false)
  WHERE sequence >= ? AND sequence <= ?
), expanded AS (
  SELECT
    LEAST(? - 1, FLOOR((detector_index::DOUBLE * ?) / ?)::INTEGER) AS x,
    LEAST(? - 1, FLOOR(((sequence - ?)::DOUBLE * ?) / ?)::INTEGER) AS y,
    get_bit(
      CAST(detectors AS BIT),
      CAST(CAST(FLOOR(detector_index / 8) AS BIGINT) * 8
           + 7 - detector_index % 8 AS INTEGER)
    ) AS value
  FROM filtered CROSS JOIN range(0, ?) AS detector_axis(detector_index)
)
SELECT x, y, sum(value)::UBIGINT AS active_count, count(*)::UBIGINT AS sample_count
FROM expanded
GROUP BY x, y
ORDER BY y, x
"""

QUERY_TEMPLATES: Mapping[tuple[str, str, str, bool], str] = MappingProxyType(
    {
        **TABLE_TEMPLATES,
        **{
            ("time-series", "detector-weight", profile, False): (
                TIME_SERIES_DETECTOR_WEIGHT
            )
            for profile in SYNDROME_PROFILES
        },
        **{
            ("histogram", "detector-weight", profile, False): (
                HISTOGRAM_DETECTOR_WEIGHT
            )
            for profile in SYNDROME_PROFILES
        },
        **{
            ("heatmap", "detector-events", profile, False): HEATMAP_DETECTOR_EVENTS
            for profile in SYNDROME_PROFILES
        },
    }
)
