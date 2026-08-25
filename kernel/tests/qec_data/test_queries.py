from __future__ import annotations

import base64
import json
import os
import threading
from dataclasses import replace
from pathlib import Path

import duckdb
import pytest

import kernel.qec_data.queries as queries_module
from kernel.qec_data.catalog import QecCatalog
from kernel.qec_data.models import (
    IndexRange,
    QualifiedRange,
    QualifiedTimestamps,
    TimestampSeries,
    ValueStatus,
)
from kernel.qec_data.storage import SessionStorage
from kernel.qec_data.queries import (
    MAX_TABLE_ROWS,
    CancellationToken,
    QecQueryEngine,
    QueryCancelled,
    QueryExecutionError,
    QueryNotSupported,
    QueryValidationError,
)
from kernel.qec_data.tiles import (
    MAX_QUERY_EVENT_BYTES,
    QueryProgress,
    QueryRequiresRefinement,
    QuerySerializationError,
    QueryTile,
    encode_binary,
    make_query_tile,
    serialize_query_event,
)
from kernel.tests.qec_data.test_storage import (
    create_storage,
    sample_batch,
    sample_identity,
    sample_session,
)


def catalog_with_rows(root: Path, *, start: int = 0) -> tuple[QecCatalog, str]:
    storage = create_storage(root)
    detector_data = bytes((0, 0, 1, 0, 3, 0, 0, 1, 1, 1))
    storage.append_batch(
        sample_batch(start=start, count=5, detector_data=detector_data)
    )
    storage.commit_segment("segment-0001")
    catalog = QecCatalog(storage)
    dataset = catalog.synchronize()[0]
    return catalog, dataset.dataset_id


def query_spec(
    dataset_id: str,
    *,
    tile: str = "table-page",
    filters: dict[str, object] | None = None,
    request_id: str = "request-1",
    width: int = 64,
    height: int = 32,
) -> dict[str, object]:
    return {
        "requestId": request_id,
        "sessionId": "session-1",
        "datasetId": dataset_id,
        "tile": tile,
        "selection": {
            "primary": None,
            "scope": [],
            "timeWindow": None,
            "source": "user",
        },
        "resolution": {"width": width, "height": height},
        "filters": (
            filters if filters is not None else {"start": 0, "end": 100, "limit": 2}
        ),
    }


def tile_event(events: list[object]) -> QueryTile:
    return next(event for event in events if isinstance(event, QueryTile))


def test_table_query_enforces_page_cap(tmp_path: Path) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    spec = query_spec(
        dataset_id,
        filters={"start": 0, "end": 100, "limit": MAX_TABLE_ROWS + 1},
    )

    with pytest.raises(QueryValidationError, match="10,000"):
        list(QecQueryEngine(catalog).execute(spec, CancellationToken()))

    accepted = query_spec(
        dataset_id,
        filters={"start": 0, "end": 100, "limit": MAX_TABLE_ROWS},
    )
    assert tile_event(
        list(QecQueryEngine(catalog).execute(accepted, CancellationToken()))
    )


def test_table_query_uses_stable_uint64_keyset_cursor(tmp_path: Path) -> None:
    start = 0
    catalog, dataset_id = catalog_with_rows(tmp_path, start=start)
    engine = QecQueryEngine(catalog)
    first = tile_event(
        list(
            engine.execute(
                query_spec(
                    dataset_id,
                    filters={"start": start, "end": start + 4, "limit": 2},
                ),
                CancellationToken(),
            )
        )
    )
    rows = first.tile.content["rows"]
    assert [row["sequence"] for row in rows] == [str(start), str(start + 1)]
    cursor = first.tile.content["nextCursor"]
    assert isinstance(cursor, str) and len(cursor) <= 1024

    padded = cursor + "=" * (-len(cursor) % 4)
    cursor_value = json.loads(base64.urlsafe_b64decode(padded))
    cursor_value["last_sequence"] = str(2**53 + 17)
    cursor = (
        base64.urlsafe_b64encode(
            json.dumps(cursor_value, sort_keys=True, separators=(",", ":")).encode()
        )
        .rstrip(b"=")
        .decode()
    )

    second_spec = query_spec(
        dataset_id,
        request_id="request-2",
        filters={
            "start": start,
            "end": start + 4,
            "limit": 2,
            "cursor": cursor,
        },
    )
    second = tile_event(
        list(engine.execute(second_spec, CancellationToken()))
    ).tile.content["rows"]
    assert second == []


def test_table_keyset_pages_have_no_gaps_or_duplicates(tmp_path: Path) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    engine = QecQueryEngine(catalog)
    first = tile_event(
        list(engine.execute(query_spec(dataset_id), CancellationToken()))
    ).tile.content
    second_spec = query_spec(
        dataset_id,
        request_id="request-2",
        filters={
            "start": 0,
            "end": 100,
            "limit": 2,
            "cursor": first["nextCursor"],
        },
    )
    second = tile_event(
        list(engine.execute(second_spec, CancellationToken()))
    ).tile.content
    sequences = [row["sequence"] for row in first["rows"] + second["rows"]]
    assert sequences == ["0", "1", "2", "3"]


@pytest.mark.parametrize(
    ("timestamps", "rounds", "expected_keys"),
    [
        (False, False, {"sequence", "detectors_b64"}),
        (True, False, {"sequence", "timestamp_ns", "detectors_b64"}),
        (False, True, {"sequence", "round", "detectors_b64"}),
        (
            True,
            True,
            {"sequence", "timestamp_ns", "round", "detectors_b64"},
        ),
    ],
)
def test_table_pages_serialize_all_four_static_schema_profiles(
    tmp_path: Path,
    timestamps: bool,
    rounds: bool,
    expected_keys: set[str],
) -> None:
    storage = create_storage(tmp_path)
    batch = sample_batch()
    if timestamps:
        batch = replace(
            batch,
            source_timestamps=QualifiedTimestamps(
                TimestampSeries((10.0, 11.0, 12.0), "ns"), ValueStatus.MEASURED
            ),
        )
    if rounds:
        batch = replace(
            batch,
            round_range=QualifiedRange(IndexRange(30, 33), ValueStatus.MEASURED),
        )
    storage.append_batch(batch)
    storage.commit_segment("segment-0001")
    dataset_id = QecCatalog(storage).synchronize()[0].dataset_id
    engine = QecQueryEngine(QecCatalog(storage))

    first = tile_event(
        list(
            engine.execute(
                query_spec(dataset_id, filters={"start": 0, "end": 2, "limit": 1}),
                CancellationToken(),
            )
        )
    ).tile.content
    second = tile_event(
        list(
            engine.execute(
                query_spec(
                    dataset_id,
                    request_id="request-2",
                    filters={
                        "start": 0,
                        "end": 2,
                        "limit": 1,
                        "cursor": first["nextCursor"],
                    },
                ),
                CancellationToken(),
            )
        )
    ).tile.content

    assert set(first["rows"][0]) == expected_keys
    assert set(second["rows"][0]) == expected_keys
    if timestamps:
        assert first["rows"][0]["timestamp_ns"] == "10"
        assert second["rows"][0]["timestamp_ns"] == "11"
    if rounds:
        assert first["rows"][0]["round"] == "30"
        assert second["rows"][0]["round"] == "31"


@pytest.mark.parametrize(
    "mutation",
    [
        {"tile": "table-page; DROP TABLE datasets"},
        {
            "tile": "time-series",
            "filters": {
                "start": 0,
                "end": 4,
                "metric": "x); DROP TABLE datasets;--",
                "bins": 4,
            },
        },
        {"filters": {"start": 0, "end": 4, "limit": 2, "sort": "evil"}},
        {
            "selection": {
                "primary": {"kind": "raw SQL", "id": "x"},
                "scope": [],
                "timeWindow": None,
                "source": "user",
            }
        },
    ],
)
def test_query_rejects_unknown_or_injected_allowlist_values(
    tmp_path: Path, mutation: dict[str, object]
) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    spec = query_spec(dataset_id)
    spec.update(mutation)
    with pytest.raises(QueryValidationError):
        list(QecQueryEngine(catalog).execute(spec, CancellationToken()))


def test_query_tiles_are_bounded_and_use_coarse_monotonic_progress(
    tmp_path: Path,
) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    events = list(
        QecQueryEngine(catalog).execute(query_spec(dataset_id), CancellationToken())
    )
    progress = [event for event in events if isinstance(event, QueryProgress)]
    assert [event.fraction for event in progress] == sorted(
        event.fraction for event in progress
    )
    assert [event.stage for event in progress] == [
        "planning",
        "executing",
        "building-tile",
        "serializing",
        "complete",
    ]
    encoded = serialize_query_event(tile_event(events))
    assert len(encoded) <= MAX_QUERY_EVENT_BYTES


@pytest.mark.parametrize(
    ("tile", "filters"),
    [
        ("time-series", {"start": 0, "end": 4, "metric": "detector-weight", "bins": 3}),
        ("histogram", {"start": 0, "end": 4, "metric": "detector-weight", "bins": 4}),
        ("heatmap", {"start": 0, "end": 4, "metric": "detector-events"}),
        ("shot-window", {"start": 0, "end": 4, "limit": 3}),
    ],
)
def test_supported_syndrome_tiles_are_bounded(
    tmp_path: Path, tile: str, filters: dict[str, object]
) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    event = tile_event(
        list(
            QecQueryEngine(catalog).execute(
                query_spec(dataset_id, tile=tile, filters=filters, width=4, height=3),
                CancellationToken(),
            )
        )
    )
    assert event.tile.kind == tile
    assert len(serialize_query_event(event)) <= MAX_QUERY_EVENT_BYTES
    if tile == "heatmap":
        total = sum(int(cell["activeCount"]) for cell in event.tile.content["cells"])
        assert total == 6


def test_histogram_reports_actual_sparse_bin_edges_and_global_range(
    tmp_path: Path,
) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    content = tile_event(
        list(
            QecQueryEngine(catalog).execute(
                query_spec(
                    dataset_id,
                    tile="histogram",
                    filters={
                        "start": 0,
                        "end": 4,
                        "metric": "detector-weight",
                        "bins": 4,
                    },
                ),
                CancellationToken(),
            )
        )
    ).tile.content

    assert content["range"] == {"minimum": 0.0, "maximum": 2.0, "constant": False}
    assert [item["bin"] for item in content["bins"]] == [0, 2, 3]
    assert [(item["lowerBound"], item["upperBound"]) for item in content["bins"]] == [
        (0.0, 0.5),
        (1.0, 1.5),
        (1.5, 2.0),
    ]


def test_histogram_marks_constant_range_explicitly(tmp_path: Path) -> None:
    storage = create_storage(tmp_path)
    storage.append_batch(sample_batch(detector_data=bytes(6)))
    storage.commit_segment("segment-0001")
    catalog = QecCatalog(storage)
    dataset_id = catalog.synchronize()[0].dataset_id
    content = tile_event(
        list(
            QecQueryEngine(catalog).execute(
                query_spec(
                    dataset_id,
                    tile="histogram",
                    filters={
                        "start": 0,
                        "end": 2,
                        "metric": "detector-weight",
                        "bins": 4,
                    },
                ),
                CancellationToken(),
            )
        )
    ).tile.content

    assert content["range"] == {"minimum": 0.0, "maximum": 0.0, "constant": True}
    assert content["bins"] == [
        {"bin": 0, "lowerBound": 0.0, "upperBound": 0.0, "sampleCount": "3"}
    ]


def test_graph_overlay_is_typed_unsupported_for_syndrome_dataset(
    tmp_path: Path,
) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    with pytest.raises(QueryNotSupported, match="syndromes"):
        list(
            QecQueryEngine(catalog).execute(
                query_spec(dataset_id, tile="graph-overlay", filters={}),
                CancellationToken(),
            )
        )


def test_heatmap_rejects_dimension_and_expansion_budget(tmp_path: Path) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    engine = QecQueryEngine(catalog)
    with pytest.raises(QueryValidationError, match="dimension"):
        list(
            engine.execute(
                query_spec(
                    dataset_id,
                    tile="heatmap",
                    filters={"start": 0, "end": 4},
                    width=4097,
                    height=1,
                ),
                CancellationToken(),
            )
        )
    with pytest.raises(QueryValidationError, match="work budget"):
        list(
            engine.execute(
                query_spec(
                    dataset_id,
                    tile="heatmap",
                    filters={"start": 0, "end": 10_000_000},
                    width=4,
                    height=4,
                ),
                CancellationToken(),
            )
        )


def test_cursor_rejects_filter_or_dataset_mismatch_and_malformed_base64(
    tmp_path: Path,
) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    engine = QecQueryEngine(catalog)
    first = tile_event(
        list(engine.execute(query_spec(dataset_id), CancellationToken()))
    )
    cursor = first.tile.content["nextCursor"]
    padded = cursor + "=" * (-len(cursor) % 4)
    mismatched = json.loads(base64.urlsafe_b64decode(padded))
    mismatched["dataset_id"] = "b" * 64
    wrong_dataset = (
        base64.urlsafe_b64encode(
            json.dumps(mismatched, sort_keys=True, separators=(",", ":")).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    duplicate_json = (
        base64.urlsafe_b64decode(padded).decode().replace('"v":1', '"v":1,"v":1')
    )
    duplicate_cursor = (
        base64.urlsafe_b64encode(duplicate_json.encode()).rstrip(b"=").decode()
    )
    for bad_filters in (
        {"start": 1, "end": 100, "limit": 2, "cursor": cursor},
        {"start": 0, "end": 100, "limit": 2, "cursor": "%%%"},
        {"start": 0, "end": 100, "limit": 2, "cursor": wrong_dataset},
        {"start": 0, "end": 100, "limit": 2, "cursor": "a" * 1025},
        {"start": 0, "end": 100, "limit": 2, "cursor": duplicate_cursor},
        {"start": 0, "end": 100, "limit": 2, "cursor": cursor + "="},
    ):
        with pytest.raises(QueryValidationError, match="cursor"):
            list(
                engine.execute(
                    query_spec(dataset_id, filters=bad_filters), CancellationToken()
                )
            )


def test_cancelled_query_stops_before_sql(tmp_path: Path) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    token = CancellationToken()
    token.cancel()
    with pytest.raises(QueryCancelled):
        list(QecQueryEngine(catalog).execute(query_spec(dataset_id), token))


def test_cancelled_after_sql_stops_before_tile(tmp_path: Path) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)

    class CancelAfterSql(CancellationToken):
        def __init__(self) -> None:
            super().__init__()
            self.checks = 0

        def raise_if_cancelled(self) -> None:
            self.checks += 1
            if self.checks == 4:
                self.cancel()
            super().raise_if_cancelled()

    with pytest.raises(QueryCancelled):
        list(QecQueryEngine(catalog).execute(query_spec(dataset_id), CancelAfterSql()))


def test_cancel_interrupts_only_the_active_dedicated_connection(tmp_path: Path) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    started = threading.Event()
    interrupted = threading.Event()

    class BlockingConnection:
        def execute(self, *_args: object):
            started.set()
            interrupted.wait(timeout=2)
            raise duckdb.InterruptException("interrupted")

        def interrupt(self) -> None:
            interrupted.set()

        def close(self) -> None:
            pass

    engine = QecQueryEngine(
        catalog, connection_factory=lambda _config: BlockingConnection()
    )
    errors: list[BaseException] = []

    def consume() -> None:
        try:
            list(engine.execute(query_spec(dataset_id), CancellationToken()))
        except BaseException as error:
            errors.append(error)

    worker = threading.Thread(target=consume)
    worker.start()
    assert started.wait(timeout=2)
    assert engine.cancel("request-1")
    worker.join(timeout=2)
    assert not worker.is_alive()
    assert len(errors) == 1 and isinstance(errors[0], QueryCancelled)


def test_duckdb_errors_are_bounded_and_do_not_expose_sql(tmp_path: Path) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)

    class BrokenConnection:
        def execute(self, *_args: object):
            raise duckdb.BinderException("SECRET SELECT * FROM private")

        def close(self) -> None:
            pass

    engine = QecQueryEngine(
        catalog, connection_factory=lambda _config: BrokenConnection()
    )
    with pytest.raises(QueryExecutionError) as caught:
        list(engine.execute(query_spec(dataset_id), CancellationToken()))
    assert "SECRET" not in str(caught.value)


def test_queries_bind_exact_paths_and_use_dedicated_resource_budgets(
    tmp_path: Path,
) -> None:
    catalog, dataset_id = catalog_with_rows(tmp_path)
    dataset = catalog.resolve("session-1", dataset_id)
    configs = []
    connections = []
    bound_paths: list[list[str]] = []

    class RecordingConnection:
        def __init__(self, config) -> None:
            self.connection = queries_module._open_query_connection(config)

        def execute(self, template: str, parameters: list[object]):
            bound_paths.append(parameters[0])
            return self.connection.execute(template, parameters)

        def interrupt(self) -> None:
            self.connection.interrupt()

        def close(self) -> None:
            self.connection.close()

    def factory(config):
        configs.append(config)
        connection = RecordingConnection(config)
        connections.append(connection)
        return connection

    engine = QecQueryEngine(catalog, connection_factory=factory)
    list(engine.execute(query_spec(dataset_id), CancellationToken()))
    list(
        engine.execute(
            query_spec(dataset_id, request_id="request-2"), CancellationToken()
        )
    )

    assert connections[0] is not connections[1]
    assert all(config.memory_limit == "512MB" for config in configs)
    assert all(config.threads == 2 for config in configs)
    assert all(config.max_temp_directory_size == "2GB" for config in configs)
    expected = [str(path) for path in dataset.partitions]
    assert bound_paths == [expected, expected]


def test_complete_event_cap_counts_utf8_base64_and_rejects_nonfinite() -> None:
    binary = base64.b64encode(os.urandom(128)).decode("ascii")
    event = make_query_tile(
        "request-ü",
        "dataset-1",
        "table-page",
        {"rows": [{"sequence": "1", "detectors_b64": binary, "label": "λ"}]},
    )
    assert len(serialize_query_event(event)) <= MAX_QUERY_EVENT_BYTES
    with pytest.raises((ValueError, QueryRequiresRefinement)):
        make_query_tile(
            "request-1", "dataset-1", "time-series", {"points": [float("nan")]}
        )


def test_python_query_tile_fixture_preserves_exact_server_bytes() -> None:
    fixture_path = (
        Path(__file__).parents[3]
        / "schemas/qec-data/v1/fixtures/python-query-tile.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    event = make_query_tile(
        "request-λ",
        "dataset-1",
        "time-series",
        {"points": [{"small": 1e-7, "whole": 1.0, "label": "μ"}]},
    )

    assert event.to_wire() == fixture["event"]
    assert serialize_query_event(event).decode("utf-8") == fixture["serializedFrame"]
    assert len(serialize_query_event(event)) == fixture["frameByteLength"]
    assert event.tile.byte_length == fixture["serverMeasuredTileBytes"]
    assert fixture["boundary"] == {
        "accepted": MAX_QUERY_EVENT_BYTES,
        "rejected": MAX_QUERY_EVENT_BYTES + 1,
    }


def test_query_event_dtos_reject_spoofing_and_serialize_progress() -> None:
    progress = QueryProgress("request-1", 0.5, "executing")
    assert serialize_query_event(progress).startswith(b'{"fraction":0.5')
    event = make_query_tile("request-1", "dataset-1", "table-page", {"rows": []})
    with pytest.raises(TypeError, match="make_query_tile"):
        QueryTile("request-1", event.tile, True, b"{}", object())
    with pytest.raises(QuerySerializationError, match="bytes"):
        encode_binary("not bytes")  # type: ignore[arg-type]
    with pytest.raises(QuerySerializationError, match="kind"):
        make_query_tile("request-1", "dataset-1", "unknown", {})


def test_complete_event_one_mib_cap_is_exact() -> None:
    low, high = 0, MAX_QUERY_EVENT_BYTES
    accepted = None
    while low <= high:
        middle = (low + high) // 2
        try:
            accepted = make_query_tile(
                "r", "d", "table-page", {"rows": [], "padding": "x" * middle}
            )
            low = middle + 1
        except QueryRequiresRefinement:
            high = middle - 1
    assert accepted is not None
    assert len(serialize_query_event(accepted)) == MAX_QUERY_EVENT_BYTES
    with pytest.raises(QueryRequiresRefinement):
        make_query_tile("r", "d", "table-page", {"rows": [], "padding": "x" * low})


def test_table_page_refines_by_frame_size_and_rejects_one_oversized_row(
    tmp_path: Path,
) -> None:
    width = 2_200_000
    identity = replace(sample_identity(), bit_widths=(("detectors", width),))
    storage = SessionStorage.create(tmp_path / "paged", sample_session(), identity)
    storage.append_batch(
        sample_batch(
            count=3,
            detector_width=width,
            detector_data=bytes(3 * ((width + 7) // 8)),
        )
    )
    storage.commit_segment("segment-0001")
    catalog = QecCatalog(storage)
    dataset_id = catalog.synchronize()[0].dataset_id
    event = tile_event(
        list(
            QecQueryEngine(catalog).execute(
                query_spec(dataset_id, filters={"start": 0, "end": 2, "limit": 3}),
                CancellationToken(),
            )
        )
    )
    assert len(event.tile.content["rows"]) == 2
    assert event.tile.content["nextCursor"] is not None

    huge_width = 7_000_000
    huge_identity = replace(sample_identity(), bit_widths=(("detectors", huge_width),))
    huge = SessionStorage.create(
        tmp_path / "oversized", sample_session(), huge_identity
    )
    huge.append_batch(
        sample_batch(
            count=1,
            detector_width=huge_width,
            detector_data=bytes((huge_width + 7) // 8),
        )
    )
    huge.commit_segment("segment-0001")
    huge_catalog = QecCatalog(huge)
    huge_dataset = huge_catalog.synchronize()[0].dataset_id
    with pytest.raises(QueryRequiresRefinement, match="one table row"):
        list(
            QecQueryEngine(huge_catalog).execute(
                query_spec(huge_dataset, filters={"start": 0, "end": 0, "limit": 1}),
                CancellationToken(),
            )
        )
