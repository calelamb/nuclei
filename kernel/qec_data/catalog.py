"""Rebuildable DuckDB catalog over journal-committed QEC partitions."""

from __future__ import annotations

import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

import duckdb
import pyarrow.parquet as pq

from .hashing import DatasetSemanticIdentity, canonical_json_bytes, is_sha256
from .model_codecs import loads_canonical_json, session_from_mapping
from .models import SCHEMA_VERSION
from .storage import SessionStorage
from .storage_paths import safe_session_file, secure_directory


CREATE_STATE = """
CREATE TABLE IF NOT EXISTS catalog_state (
  session_id VARCHAR PRIMARY KEY,
  journal_generation UBIGINT NOT NULL
)
"""
CREATE_DATASETS = """
CREATE TABLE IF NOT EXISTS datasets (
  dataset_id VARCHAR PRIMARY KEY,
  session_id VARCHAR NOT NULL,
  schema_version VARCHAR NOT NULL,
  record_kind VARCHAR NOT NULL,
  schema_fingerprint VARCHAR NOT NULL,
  journal_generation UBIGINT NOT NULL,
  schema_profile VARCHAR NOT NULL,
  semantic_identity_json VARCHAR NOT NULL,
  detector_count UINTEGER,
  observable_count UINTEGER,
  measurement_count UINTEGER
)
"""
CREATE_PARTITIONS = """
CREATE TABLE IF NOT EXISTS partitions (
  dataset_id VARCHAR NOT NULL,
  segment_id VARCHAR NOT NULL,
  relative_path VARCHAR NOT NULL,
  sha256 VARCHAR NOT NULL,
  rows UBIGINT NOT NULL,
  sequence_start UBIGINT NOT NULL,
  sequence_end UBIGINT NOT NULL,
  PRIMARY KEY (dataset_id, relative_path)
)
"""
INSERT_DATASET = """
INSERT INTO datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""
INSERT_PARTITION = """
INSERT INTO partitions VALUES (?, ?, ?, ?, ?, ?, ?)
"""
STATE_QUERY = """
SELECT journal_generation FROM catalog_state WHERE session_id = ?
"""
COUNTS_QUERY = """
SELECT
  count(*)::UBIGINT,
  coalesce(sum(CASE WHEN journal_generation = ? THEN 0 ELSE 1 END), 0)::UBIGINT
FROM datasets
WHERE session_id = ?
"""
PARTITION_COUNT_QUERY = "SELECT count(*)::UBIGINT FROM partitions"


class CatalogError(RuntimeError):
    """Base error for bounded catalog operations."""


class CatalogIntegrityError(CatalogError):
    """The durable journal snapshot could not be verified."""


class CatalogNotFound(CatalogError):
    """The requested journal-visible dataset does not exist."""


@dataclass(frozen=True, slots=True)
class CatalogDataset:
    dataset_id: str
    session_id: str
    schema_version: str
    record_kind: str
    schema_fingerprint: str
    journal_generation: int
    schema_profile: str
    semantic_identity_json: str
    detector_count: int | None
    observable_count: int | None
    measurement_count: int | None
    sequence_start: int
    sequence_end: int
    partitions: tuple[Path, ...]

    @property
    def semantic_identity(self) -> Mapping[str, object]:
        value = loads_canonical_json(self.semantic_identity_json)
        if not isinstance(value, dict):
            raise CatalogIntegrityError("catalog semantic identity is invalid")
        return MappingProxyType(value)


@dataclass(frozen=True, slots=True)
class _Snapshot:
    session_id: str
    generation: int
    datasets: tuple[CatalogDataset, ...]
    partition_rows: tuple[tuple[object, ...], ...]


class QecCatalog:
    """A rebuildable cache whose source of truth remains SessionStorage."""

    def __init__(self, storage: SessionStorage) -> None:
        if type(storage) is not SessionStorage:
            raise TypeError("catalog storage must be SessionStorage")
        self._storage = storage
        self._lock = threading.RLock()
        self._safe_database_path()

    @property
    def database_path(self) -> Path:
        return self._safe_database_path()

    @property
    def temp_directory(self) -> Path:
        return secure_directory(
            self._storage.session_root, "indexes/duckdb-tmp", create=True
        )

    def synchronize(self) -> tuple[CatalogDataset, ...]:
        with self._lock:
            snapshot = self._stable_snapshot()
            self.temp_directory
            database_path = self._safe_database_path()
            try:
                with duckdb.connect(str(database_path)) as connection:
                    self._create_schema(connection)
                    if not self._cache_matches(connection, snapshot):
                        self._rebuild(connection, snapshot)
            except duckdb.Error as error:
                raise CatalogError("QEC catalog synchronization failed") from error
            return snapshot.datasets

    def _safe_database_path(self) -> Path:
        secure_directory(self._storage.session_root, "indexes")
        return safe_session_file(self._storage.session_root, "indexes/catalog.duckdb")

    def resolve(self, session_id: str, dataset_id: str) -> CatalogDataset:
        if not isinstance(session_id, str) or not isinstance(dataset_id, str):
            raise CatalogNotFound("QEC dataset was not found")
        for dataset in self.synchronize():
            if dataset.session_id == session_id and dataset.dataset_id == dataset_id:
                return dataset
        raise CatalogNotFound("QEC dataset was not found")

    def _stable_snapshot(self) -> _Snapshot:
        for _ in range(3):
            first = self._read_boundary("journal.json")
            try:
                committed = self._storage.list_committed_partitions()
                verification = self._storage.verify()
            except (OSError, ValueError) as error:
                raise CatalogIntegrityError("committed journal is invalid") from error
            second = self._read_boundary("journal.json")
            if first == second and verification.ok:
                return self._build_snapshot(first, committed)
        raise CatalogIntegrityError("journal changed during catalog synchronization")

    def _read_boundary(self, name: str) -> Mapping[str, Any]:
        try:
            value = loads_canonical_json(
                (self._storage.session_root / name).read_text(encoding="utf-8")
            )
        except (OSError, ValueError) as error:
            raise CatalogIntegrityError(
                f"catalog {name} boundary is invalid"
            ) from error
        if not isinstance(value, dict):
            raise CatalogIntegrityError(f"catalog {name} boundary is invalid")
        return value

    def _build_snapshot(
        self, journal: Mapping[str, Any], committed: tuple[object, ...]
    ) -> _Snapshot:
        try:
            generation = _uint(journal["generation"], "journal generation")
            session = session_from_mapping(self._read_boundary("manifest.json"))
            identity = DatasetSemanticIdentity.from_mapping(
                self._read_boundary("identity.json")
            )
            segments = journal["segments"]
            if not isinstance(segments, list):
                raise TypeError("journal segments must be an array")
            paths = tuple(ref.path for ref in committed)  # type: ignore[attr-defined]
            return _snapshot_from_segments(
                self._storage.session_root,
                session.session_id,
                generation,
                segments,
                paths,
                identity,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise CatalogIntegrityError(
                "committed catalog snapshot is invalid"
            ) from error

    @staticmethod
    def _create_schema(connection: duckdb.DuckDBPyConnection) -> None:
        connection.execute(CREATE_STATE)
        connection.execute(CREATE_DATASETS)
        connection.execute(CREATE_PARTITIONS)

    @staticmethod
    def _cache_matches(
        connection: duckdb.DuckDBPyConnection, snapshot: _Snapshot
    ) -> bool:
        state = connection.execute(STATE_QUERY, [snapshot.session_id]).fetchone()
        if state is None or state[0] != snapshot.generation:
            return False
        counts = connection.execute(
            COUNTS_QUERY, [snapshot.generation, snapshot.session_id]
        ).fetchone()
        partitions = connection.execute(PARTITION_COUNT_QUERY).fetchone()
        return bool(
            counts
            and partitions
            and counts == (len(snapshot.datasets), 0)
            and partitions[0] == len(snapshot.partition_rows)
        )

    @staticmethod
    def _rebuild(connection: duckdb.DuckDBPyConnection, snapshot: _Snapshot) -> None:
        connection.execute("BEGIN TRANSACTION")
        try:
            connection.execute("DELETE FROM partitions")
            connection.execute("DELETE FROM datasets")
            connection.execute("DELETE FROM catalog_state")
            for dataset in snapshot.datasets:
                connection.execute(INSERT_DATASET, _dataset_row(dataset))
            for partition in snapshot.partition_rows:
                connection.execute(INSERT_PARTITION, partition)
            connection.execute(
                "INSERT INTO catalog_state VALUES (?, ?)",
                [snapshot.session_id, snapshot.generation],
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise


def _uint(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value < 2**64:
        raise ValueError(f"{name} must be uint64")
    return value


def _schema_profile(path: Path) -> str:
    names = frozenset(pq.read_schema(path).names)
    required = frozenset({"sequence", "detectors"})
    if not required <= names:
        raise ValueError("syndrome schema is missing required fields")
    timestamp = "timestamp_ns" in names
    rounds = "round" in names
    return {
        (False, False): "base",
        (True, False): "timestamp",
        (False, True): "round",
        (True, True): "timestamp-round",
    }[(timestamp, rounds)]


def _snapshot_from_segments(
    session_root: Path,
    session_id: str,
    generation: int,
    segments: list[object],
    committed_paths: tuple[Path, ...],
    identity: DatasetSemanticIdentity,
) -> _Snapshot:
    committed = frozenset(committed_paths)
    datasets: list[CatalogDataset] = []
    partition_rows: list[tuple[object, ...]] = []
    observed: set[Path] = set()
    for raw_segment in segments:
        dataset, rows, paths = _segment_dataset(
            session_root, session_id, generation, raw_segment, identity
        )
        datasets.append(dataset)
        partition_rows.extend(rows)
        observed.update(paths)
    if observed != committed:
        raise CatalogIntegrityError("journal and committed partition lists differ")
    return _Snapshot(session_id, generation, tuple(datasets), tuple(partition_rows))


def _segment_dataset(
    session_root: Path,
    session_id: str,
    generation: int,
    raw_segment: object,
    identity: DatasetSemanticIdentity,
) -> tuple[CatalogDataset, tuple[tuple[object, ...], ...], tuple[Path, ...]]:
    if not isinstance(raw_segment, dict):
        raise TypeError("journal segment must be an object")
    dataset_id = raw_segment["dataset_id"]
    fingerprint = raw_segment["schema_fingerprint"]
    segment_id = raw_segment["segment_id"]
    record_kind = raw_segment["record_kind"]
    if not is_sha256(dataset_id) or not is_sha256(fingerprint):
        raise ValueError("journal dataset identity is invalid")
    if not all(isinstance(value, str) for value in (segment_id, record_kind)):
        raise TypeError("journal segment identity is invalid")
    raw_partitions = raw_segment["partitions"]
    if not isinstance(raw_partitions, list) or not raw_partitions:
        raise ValueError("catalog dataset must contain committed partitions")
    paths, rows = _partition_rows(
        session_root, str(dataset_id), str(segment_id), raw_partitions
    )
    widths = dict(identity.bit_widths)
    starts = tuple(_uint(item[4], "sequence start") for item in rows)
    ends = tuple(_uint(item[5], "sequence end") for item in rows)
    dataset = CatalogDataset(
        str(dataset_id),
        session_id,
        SCHEMA_VERSION,
        str(record_kind),
        str(fingerprint),
        generation,
        _schema_profile(paths[0]),
        canonical_json_bytes(identity.to_mapping()).decode("utf-8"),
        widths.get("detectors"),
        widths.get("observables"),
        widths.get("measurements"),
        min(starts),
        max(ends),
        paths,
    )
    return dataset, rows, paths


def _partition_rows(
    session_root: Path,
    dataset_id: str,
    segment_id: str,
    raw_partitions: list[object],
) -> tuple[tuple[Path, ...], tuple[tuple[object, ...], ...]]:
    paths: list[Path] = []
    rows: list[tuple[object, ...]] = []
    for raw in raw_partitions:
        if not isinstance(raw, dict):
            raise TypeError("journal partition must be an object")
        relative = raw["path"]
        if not isinstance(relative, str):
            raise TypeError("journal path must be a string")
        path = session_root / relative
        paths.append(path)
        rows.append(
            (
                dataset_id,
                segment_id,
                relative,
                raw["sha256"],
                _uint(raw["rows"], "partition rows"),
                _uint(raw["sequence_start"], "sequence start"),
                _uint(raw["sequence_end"], "sequence end"),
            )
        )
    return tuple(paths), tuple(rows)


def _dataset_row(dataset: CatalogDataset) -> tuple[object, ...]:
    return (
        dataset.dataset_id,
        dataset.session_id,
        dataset.schema_version,
        dataset.record_kind,
        dataset.schema_fingerprint,
        dataset.journal_generation,
        dataset.schema_profile,
        dataset.semantic_identity_json,
        dataset.detector_count,
        dataset.observable_count,
        dataset.measurement_count,
    )
