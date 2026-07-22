"""Strict fixed-template DuckDB queries for bounded QEC visualization tiles."""

from __future__ import annotations

import base64
import binascii
import threading
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

import duckdb
import pyarrow as pa

from .catalog import CatalogDataset, CatalogError, QecCatalog
from .hashing import canonical_json_bytes, semantic_digest
from .model_codecs import loads_canonical_json
from .query_table_templates import TABLE_TEMPLATES
from .tiles import (
    QueryEvent,
    QueryProgress,
    QueryRequiresRefinement,
    QueryTile,
    encode_binary,
    make_query_tile,
    serialize_query_event,
    validate_selection,
)


MAX_TABLE_ROWS, MAX_CURSOR_BYTES = 10_000, 1_024
MAX_WIDTH, MAX_HEIGHT, MAX_CELLS = 4_096, 1_024, 65_536
MAX_BINS, MAX_SCAN_ROWS, MAX_EXPANDED_CELLS = 4_096, 50_000_000, 50_000_000
UINT64_MAX = 2**64 - 1
SCHEMA_PROFILES = frozenset({"base", "timestamp", "round", "timestamp-round"})

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
            (
                "time-series",
                "detector-weight",
                profile,
                False,
            ): TIME_SERIES_DETECTOR_WEIGHT
            for profile in SCHEMA_PROFILES
        },
        **{
            ("histogram", "detector-weight", profile, False): HISTOGRAM_DETECTOR_WEIGHT
            for profile in SCHEMA_PROFILES
        },
        **{
            ("heatmap", "detector-events", profile, False): HEATMAP_DETECTOR_EVENTS
            for profile in SCHEMA_PROFILES
        },
    }
)

FILTER_FIELDS: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        "table-page": frozenset({"start", "end", "limit", "cursor"}),
        "shot-window": frozenset({"start", "end", "limit", "cursor"}),
        "time-series": frozenset({"start", "end", "metric", "bins"}),
        "histogram": frozenset({"start", "end", "metric", "bins"}),
        "heatmap": frozenset({"start", "end", "metric"}),
        "graph-overlay": frozenset(),
    }
)


class QueryError(RuntimeError): ...


class QueryValidationError(QueryError): ...


class QueryNotSupported(QueryError): ...


class QueryCancelled(QueryError): ...


class QueryExecutionError(QueryError): ...


class CancellationToken:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    def is_cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self.is_cancelled():
            raise QueryCancelled("QEC query was cancelled")


@dataclass(frozen=True, slots=True)
class QueryResolution:
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class QuerySpec:
    request_id: str
    session_id: str
    dataset_id: str
    tile: str
    selection_json: str
    resolution: QueryResolution
    filters: tuple[tuple[str, str | int | float | bool], ...]

    @classmethod
    def from_mapping(cls, value: object) -> QuerySpec:
        item = _strict_mapping(
            value,
            "query spec",
            frozenset(
                {
                    "requestId",
                    "sessionId",
                    "datasetId",
                    "tile",
                    "selection",
                    "resolution",
                    "filters",
                }
            ),
        )
        tile = _text(item["tile"], "tile")
        if tile not in FILTER_FIELDS:
            raise QueryValidationError("query tile kind is not allowlisted")
        try:
            selection = validate_selection(item["selection"])
        except ValueError as error:
            raise QueryValidationError("query selection is invalid") from error
        resolution = _validate_resolution(item["resolution"])
        filters = _validate_filters(tile, item["filters"])
        return cls(
            _bounded_text(item["requestId"], "request ID"),
            _bounded_text(item["sessionId"], "session ID"),
            _bounded_text(item["datasetId"], "dataset ID"),
            tile,
            canonical_json_bytes(selection).decode("utf-8"),
            resolution,
            filters,
        )

    @property
    def filter_map(self) -> dict[str, str | int | float | bool]:
        return dict(self.filters)


@dataclass(frozen=True, slots=True)
class QueryConnectionConfig:
    temp_directory: Path
    memory_limit: str = "512MB"
    threads: int = 2
    max_temp_directory_size: str = "2GB"


@dataclass(frozen=True, slots=True)
class QueryPlan:
    spec: QuerySpec
    dataset: CatalogDataset
    template: str
    parameters: tuple[object, ...]
    metric: str
    result_row_cap: int
    query_hash: str
    page_limit: int | None = None


@dataclass(frozen=True, slots=True)
class _ActiveQuery:
    token: Any
    connection: Any


ConnectionFactory = Callable[[QueryConnectionConfig], Any]


class QecQueryEngine:
    def __init__(
        self,
        catalog: QecCatalog,
        *,
        connection_factory: ConnectionFactory | None = None,
    ) -> None:
        if type(catalog) is not QecCatalog:
            raise TypeError("query catalog must be QecCatalog")
        self._catalog = catalog
        self._connection_factory = connection_factory or _open_query_connection
        self._active: dict[str, _ActiveQuery] = {}
        self._active_lock = threading.Lock()

    def execute(
        self, raw_spec: QuerySpec | Mapping[str, object], cancel: CancellationToken
    ) -> Iterator[QueryEvent]:
        _validate_cancel_token(cancel)
        cancel.raise_if_cancelled()
        spec = (
            raw_spec
            if type(raw_spec) is QuerySpec
            else QuerySpec.from_mapping(raw_spec)
        )
        yield QueryProgress(spec.request_id, 0.0, "planning")
        try:
            dataset = self._catalog.resolve(spec.session_id, spec.dataset_id)
        except CatalogError as error:
            raise QueryValidationError("query dataset is unavailable") from error
        plan = _build_plan(spec, dataset)
        cancel.raise_if_cancelled()
        config = QueryConnectionConfig(self._catalog.temp_directory)
        try:
            connection = self._connection_factory(config)
        except duckdb.Error as error:
            raise QueryExecutionError("QEC query connection failed") from error
        registered = False
        try:
            self._register(spec.request_id, cancel, connection)
            registered = True
            yield QueryProgress(spec.request_id, 0.1, "executing")
            batches = self._run_sql(plan, connection, cancel)
            cancel.raise_if_cancelled()
            yield QueryProgress(spec.request_id, 0.85, "building-tile")
            event = _build_event(plan, batches)
            cancel.raise_if_cancelled()
            yield QueryProgress(spec.request_id, 0.95, "serializing")
            serialize_query_event(event)
            cancel.raise_if_cancelled()
            yield QueryProgress(spec.request_id, 1.0, "complete")
            yield event
        finally:
            if registered:
                self._unregister(spec.request_id, connection)
            connection.close()

    def cancel(self, request_id: str) -> bool:
        with self._active_lock:
            active = self._active.get(request_id)
        if active is None:
            return False
        active.token.cancel()
        active.connection.interrupt()
        return True

    def _register(self, request_id: str, token: Any, connection: Any) -> None:
        with self._active_lock:
            if request_id in self._active:
                raise QueryValidationError("query request ID is already active")
            self._active[request_id] = _ActiveQuery(token, connection)

    def _unregister(self, request_id: str, connection: Any) -> None:
        with self._active_lock:
            active = self._active.get(request_id)
            if active is not None and active.connection is connection:
                del self._active[request_id]

    @staticmethod
    def _run_sql(
        plan: QueryPlan, connection: Any, cancel: CancellationToken
    ) -> tuple[pa.RecordBatch, ...]:
        cancel.raise_if_cancelled()
        try:
            cursor = connection.execute(plan.template, list(plan.parameters))
            reader = cursor.fetch_record_batch(8_192)
            return _bounded_batches(reader, plan.result_row_cap)
        except duckdb.InterruptException as error:
            raise QueryCancelled("QEC query was cancelled") from error
        except duckdb.Error as error:
            raise QueryExecutionError("QEC query execution failed") from error


def _open_query_connection(config: QueryConnectionConfig) -> duckdb.DuckDBPyConnection:
    config.temp_directory.mkdir(exist_ok=True)
    return duckdb.connect(
        database=":memory:",
        config={
            "memory_limit": config.memory_limit,
            "threads": str(config.threads),
            "temp_directory": str(config.temp_directory),
            "max_temp_directory_size": config.max_temp_directory_size,
        },
    )


def _build_plan(spec: QuerySpec, dataset: CatalogDataset) -> QueryPlan:
    if dataset.record_kind != "syndromes":
        raise QueryNotSupported("tile is not supported for this dataset kind")
    if spec.tile == "graph-overlay":
        raise QueryNotSupported("graph-overlay is not supported for syndromes")
    filters = spec.filter_map
    start = _filter_uint(filters, "start", dataset.sequence_start)
    default_end = max(dataset.sequence_start, dataset.sequence_end - 1)
    end = _filter_uint(filters, "end", default_end)
    if end < start:
        raise QueryValidationError("query end must not precede start")
    span = end - start + 1
    if span > MAX_SCAN_ROWS:
        raise QueryValidationError("query exceeds the scan work budget")
    query_hash = _query_hash(spec)
    if spec.tile in {"table-page", "shot-window"}:
        return _table_plan(spec, dataset, filters, start, end, query_hash)
    if spec.tile == "heatmap":
        return _heatmap_plan(spec, dataset, filters, start, end, span, query_hash)
    return _aggregate_plan(spec, dataset, filters, start, end, span, query_hash)


def _table_plan(
    spec: QuerySpec,
    dataset: CatalogDataset,
    filters: Mapping[str, object],
    start: int,
    end: int,
    query_hash: str,
) -> QueryPlan:
    limit = _filter_int(filters, "limit", 1_000, minimum=1)
    if limit > MAX_TABLE_ROWS:
        raise QueryValidationError("table page limit cannot exceed 10,000 rows")
    cursor = filters.get("cursor")
    after = cursor is not None
    paths = [str(path) for path in dataset.partitions]
    parameters: tuple[object, ...] = (paths, start, end)
    if after:
        last = _decode_cursor(str(cursor), spec, query_hash)
        parameters += (last,)
    parameters += (limit + 1,)
    template = _template(spec.tile, "rows", dataset.schema_profile, after)
    return QueryPlan(
        spec, dataset, template, parameters, "rows", limit + 1, query_hash, limit
    )


def _aggregate_plan(
    spec: QuerySpec,
    dataset: CatalogDataset,
    filters: Mapping[str, object],
    start: int,
    end: int,
    span: int,
    query_hash: str,
) -> QueryPlan:
    metric = _filter_text(filters, "metric", "detector-weight")
    bins = _filter_int(filters, "bins", spec.resolution.width, minimum=1)
    if bins > MAX_BINS:
        raise QueryValidationError("aggregate bins exceed the resolution limit")
    template = _template(spec.tile, metric, dataset.schema_profile, False)
    paths = [str(path) for path in dataset.partitions]
    if spec.tile == "time-series":
        params = (paths, start, end, bins, start, bins, span)
    else:
        params = (paths, start, end, bins, bins)
    return QueryPlan(spec, dataset, template, params, metric, bins, query_hash)


def _heatmap_plan(
    spec: QuerySpec,
    dataset: CatalogDataset,
    filters: Mapping[str, object],
    start: int,
    end: int,
    span: int,
    query_hash: str,
) -> QueryPlan:
    width, height = spec.resolution.width, spec.resolution.height
    if width > MAX_WIDTH or height > MAX_HEIGHT or width * height > MAX_CELLS:
        raise QueryValidationError("heatmap dimensions exceed the bounded limit")
    detectors = dataset.detector_count
    if detectors is None:
        raise QueryNotSupported("heatmap requires detector width metadata")
    if span * detectors > MAX_EXPANDED_CELLS:
        raise QueryValidationError("heatmap exceeds the work budget")
    metric = _filter_text(filters, "metric", "detector-events")
    template = _template(spec.tile, metric, dataset.schema_profile, False)
    paths = [str(path) for path in dataset.partitions]
    params = (
        paths,
        start,
        end,
        width,
        width,
        detectors,
        height,
        start,
        height,
        span,
        detectors,
    )
    return QueryPlan(
        spec, dataset, template, params, metric, width * height, query_hash
    )


def _template(tile: str, metric: str, profile: str, after: bool) -> str:
    if profile not in SCHEMA_PROFILES:
        raise QueryNotSupported("dataset schema profile is not supported")
    try:
        return QUERY_TEMPLATES[(tile, metric, profile, after)]
    except KeyError as error:
        raise QueryValidationError(
            "query metric is not allowlisted for this tile"
        ) from error


def _bounded_batches(
    reader: Iterator[pa.RecordBatch], row_cap: int
) -> tuple[pa.RecordBatch, ...]:
    batches: list[pa.RecordBatch] = []
    rows = 0
    for batch in reader:
        if not isinstance(batch, pa.RecordBatch):
            raise QueryExecutionError("QEC query returned an invalid Arrow batch")
        rows += batch.num_rows
        if rows > row_cap:
            raise QueryExecutionError("QEC query exceeded its bounded result")
        batches.append(batch)
    return tuple(batches)


def _build_event(plan: QueryPlan, batches: tuple[pa.RecordBatch, ...]) -> QueryTile:
    if plan.spec.tile in {"table-page", "shot-window"}:
        return _table_event(plan, _rows(batches))
    if plan.spec.tile == "time-series":
        content = {"metric": plan.metric, "points": _series_points(batches)}
    elif plan.spec.tile == "histogram":
        content = {
            "metric": plan.metric,
            **_histogram_content(batches, plan.result_row_cap),
        }
    else:
        content = {
            "metric": plan.metric,
            "width": plan.spec.resolution.width,
            "height": plan.spec.resolution.height,
            "cells": _heatmap_cells(batches),
        }
    return make_query_tile(
        plan.spec.request_id,
        plan.dataset.dataset_id,
        plan.spec.tile,
        content,
    )


def _rows(batches: tuple[pa.RecordBatch, ...]) -> tuple[dict[str, object], ...]:
    rows: list[dict[str, object]] = []
    for batch in batches:
        sequences = batch.column("sequence")
        detectors = batch.column("detectors")
        timestamps = (
            batch.column("timestamp_ns")
            if "timestamp_ns" in batch.schema.names
            else None
        )
        rounds = batch.column("round") if "round" in batch.schema.names else None
        for index in range(batch.num_rows):
            value = detectors[index].as_py()
            if type(value) is not bytes:
                raise QueryExecutionError("detector payload is not binary")
            row: dict[str, object] = {
                "sequence": str(sequences[index].as_py()),
                "detectors_b64": encode_binary(value),
            }
            if timestamps is not None:
                row["timestamp_ns"] = str(timestamps[index].as_py())
            if rounds is not None:
                row["round"] = str(rounds[index].as_py())
            rows.append(row)
    return tuple(rows)


def _table_event(plan: QueryPlan, rows: tuple[dict[str, object], ...]) -> QueryTile:
    limit = plan.page_limit or 0
    visible = rows[:limit]
    has_more = len(rows) > limit
    low, high = (1 if visible else 0), len(visible)
    accepted: QueryTile | None = None
    while low <= high:
        count = (low + high) // 2
        more = has_more or count < len(visible)
        content = _table_content(plan, visible[:count], more)
        try:
            accepted = make_query_tile(
                plan.spec.request_id,
                plan.dataset.dataset_id,
                plan.spec.tile,
                content,
            )
            low = count + 1
        except QueryRequiresRefinement:
            high = count - 1
    if accepted is None:
        raise QueryRequiresRefinement("one table row exceeds the 1 MiB event limit")
    return accepted


def _table_content(
    plan: QueryPlan, rows: tuple[dict[str, object], ...], has_more: bool
) -> dict[str, object]:
    cursor = None
    if has_more and rows:
        cursor = _encode_cursor(plan, rows[-1]["sequence"])
    return {"rows": list(rows), "nextCursor": cursor}


def _series_points(batches: tuple[pa.RecordBatch, ...]) -> list[dict[str, object]]:
    return [
        {
            "bin": int(row["bin"]),
            "minimum": _finite(row["minimum"]),
            "maximum": _finite(row["maximum"]),
            "mean": _finite(row["mean"]),
            "sampleCount": str(row["sample_count"]),
        }
        for row in _py_rows(batches)
    ]


def _histogram_content(
    batches: tuple[pa.RecordBatch, ...], bin_count: int
) -> dict[str, object]:
    rows = tuple(_py_rows(batches))
    if not rows:
        return {"bins": [], "range": None}
    minimum = _finite(rows[0]["lower_bound"])
    maximum = _finite(rows[0]["upper_bound"])
    constant = minimum == maximum
    width = 0.0 if constant else (maximum - minimum) / bin_count
    bins = []
    for row in rows:
        index = int(row["bin"])
        lower = minimum if constant else minimum + index * width
        upper = maximum if constant or index == bin_count - 1 else lower + width
        bins.append(
            {
                "bin": index,
                "lowerBound": lower,
                "upperBound": upper,
                "sampleCount": str(row["sample_count"]),
            }
        )
    return {
        "bins": bins,
        "range": {"minimum": minimum, "maximum": maximum, "constant": constant},
    }


def _heatmap_cells(batches: tuple[pa.RecordBatch, ...]) -> list[dict[str, object]]:
    return [
        {
            "x": int(row["x"]),
            "y": int(row["y"]),
            "activeCount": str(row["active_count"]),
            "sampleCount": str(row["sample_count"]),
        }
        for row in _py_rows(batches)
    ]


def _py_rows(batches: tuple[pa.RecordBatch, ...]) -> Iterator[dict[str, object]]:
    for batch in batches:
        yield from batch.to_pylist()


def _finite(value: object) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise QueryExecutionError("aggregate query returned a nonnumeric value")
    number = float(value)
    canonical_json_bytes(number)
    return number


def _query_hash(spec: QuerySpec) -> str:
    filters = {key: value for key, value in spec.filters if key != "cursor"}
    return semantic_digest(
        b"nuclei:qec-query:v1\0",
        {
            "session_id": spec.session_id,
            "dataset_id": spec.dataset_id,
            "tile": spec.tile,
            "selection": loads_canonical_json(spec.selection_json),
            "resolution": {
                "width": spec.resolution.width,
                "height": spec.resolution.height,
            },
            "filters": filters,
        },
    )


def _encode_cursor(plan: QueryPlan, sequence: object) -> str:
    value = str(sequence)
    _decimal_uint(value, "cursor sequence")
    payload = canonical_json_bytes(
        {
            "v": 1,
            "session_id": plan.spec.session_id,
            "dataset_id": plan.dataset.dataset_id,
            "last_sequence": value,
            "query_hash": plan.query_hash,
        }
    )
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_cursor(cursor: str, spec: QuerySpec, query_hash: str) -> int:
    if not isinstance(cursor, str) or not cursor or len(cursor) > MAX_CURSOR_BYTES:
        raise QueryValidationError("query cursor is invalid")
    if "=" in cursor or not cursor.isascii():
        raise QueryValidationError("query cursor is malformed")
    try:
        padding = "=" * (-len(cursor) % 4)
        decoded = base64.b64decode(cursor + padding, altchars=b"-_", validate=True)
        canonical = base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii")
        if canonical != cursor:
            raise ValueError("cursor is not canonical base64url")
        document = decoded.decode("utf-8")
        value = loads_canonical_json(document)
        if canonical_json_bytes(value) != decoded:
            raise ValueError("cursor JSON is not canonical")
    except (binascii.Error, UnicodeDecodeError, ValueError) as error:
        raise QueryValidationError("query cursor is malformed") from error
    item = _strict_mapping(
        value,
        "query cursor",
        frozenset({"v", "session_id", "dataset_id", "last_sequence", "query_hash"}),
    )
    if (
        item["v"] != 1
        or item["session_id"] != spec.session_id
        or item["dataset_id"] != spec.dataset_id
        or item["query_hash"] != query_hash
    ):
        raise QueryValidationError("query cursor does not match the query")
    return _decimal_uint(item["last_sequence"], "cursor sequence")


def _decimal_uint(value: object, name: str) -> int:
    if not isinstance(value, str) or not value or not value.isascii():
        raise QueryValidationError(f"{name} is invalid")
    if not value.isdecimal() or (len(value) > 1 and value.startswith("0")):
        raise QueryValidationError(f"{name} is invalid")
    number = int(value)
    if number > UINT64_MAX:
        raise QueryValidationError(f"{name} is outside uint64")
    return number


def _strict_mapping(
    value: object, name: str, keys: frozenset[str]
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise QueryValidationError(f"{name} must be an object")
    actual = frozenset(value.keys())
    if actual != keys:
        raise QueryValidationError(f"{name} fields are invalid")
    return value


def _validate_resolution(value: object) -> QueryResolution:
    item = _strict_mapping(value, "resolution", frozenset({"width", "height"}))
    width = _exact_int(item["width"], "resolution width", minimum=1)
    height = _exact_int(item["height"], "resolution height", minimum=1)
    if width > 8_192 or height > 8_192:
        raise QueryValidationError("resolution dimensions exceed the protocol limit")
    return QueryResolution(width, height)


def _validate_filters(
    tile: str, value: object
) -> tuple[tuple[str, str | int | float | bool], ...]:
    if not isinstance(value, Mapping) or not all(isinstance(key, str) for key in value):
        raise QueryValidationError("query filters must be an object")
    if not frozenset(value) <= FILTER_FIELDS[tile]:
        raise QueryValidationError("query filter is not allowlisted for this tile")
    scalar = (str, int, float, bool)
    if any(type(item) not in scalar for item in value.values()):
        raise QueryValidationError("query filter values must be JSON scalars")
    try:
        canonical_json_bytes(value)
    except (TypeError, ValueError) as error:
        raise QueryValidationError("query filters must be finite JSON") from error
    return tuple(sorted(value.items()))


def _filter_uint(filters: Mapping[str, object], key: str, default: int) -> int:
    return _exact_int(
        filters.get(key, default), f"query {key}", minimum=0, maximum=UINT64_MAX
    )


def _filter_int(
    filters: Mapping[str, object], key: str, default: int, *, minimum: int
) -> int:
    return _exact_int(filters.get(key, default), f"query {key}", minimum=minimum)


def _filter_text(filters: Mapping[str, object], key: str, default: str) -> str:
    return _text(filters.get(key, default), f"query {key}")


def _exact_int(
    value: object,
    name: str,
    *,
    minimum: int,
    maximum: int | None = None,
) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise QueryValidationError(f"{name} must be an integer >= {minimum}")
    if maximum is not None and value > maximum:
        raise QueryValidationError(f"{name} exceeds its maximum")
    return value


def _text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise QueryValidationError(f"{name} must be a nonempty string")
    return value


def _bounded_text(value: object, name: str) -> str:
    text = _text(value, name)
    if len(text) > 256 or any(ord(char) < 32 for char in text):
        raise QueryValidationError(f"{name} is invalid")
    return text


def _validate_cancel_token(value: object) -> None:
    methods = ("cancel", "is_cancelled", "raise_if_cancelled")
    if any(not callable(getattr(value, name, None)) for name in methods):
        raise TypeError("cancel token does not implement the cancellation contract")
