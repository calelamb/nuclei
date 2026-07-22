from __future__ import annotations

import asyncio
import json
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path

import pytest
import pytest_asyncio
from websockets.exceptions import ConnectionClosedError
from websockets.legacy.client import WebSocketClientProtocol, connect

from kernel.qec_data.catalog import QecCatalog
from kernel.qec_data.jobs import JobRegistry
from kernel.qec_data.model_codecs import loads_canonical_json, session_from_mapping
from kernel.qec_data.models import QualifiedText, SessionStatus, ValueStatus
from kernel.qec_data.protocol import (
    MAX_FRAME_BYTES,
    MessageType,
    OutboundFrameTooLarge,
    ProtocolError,
    encode_frame,
    parse_authentication,
    parse_request,
    query_requires_refinement_frame,
)
from kernel.qec_data.server import (
    PortInUseError,
    QecDataServer,
    finalize_session_manifest,
)
from kernel.qec_data.storage import SessionStorage
from kernel.tests.qec_data.test_storage import (
    create_storage,
    sample_batch,
    sample_identity,
    sample_session,
)


TOKEN = "ab" * 32
SINTER_HEADER = (
    "shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts\n"
)
SINTER_ROW = '100,3,0,1.25,pymatching,strong-a,"{""d"":3}",{}\n'


@pytest_asyncio.fixture
async def qec_data_server(tmp_path: Path):
    server = QecDataServer(
        project_root=tmp_path,
        token=TOKEN,
        port=0,
        authentication_timeout=0.05,
    )
    await server.start()
    try:
        yield server
    finally:
        await server.stop()


@asynccontextmanager
async def authenticated(
    server: QecDataServer,
) -> AsyncIterator[WebSocketClientProtocol]:
    async with connect(server.url) as websocket:
        await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
        assert json.loads(await websocket.recv()) == {"type": "authenticated"}
        yield websocket


def write_sinter_source(root: Path) -> Path:
    source = root / "stats.csv"
    source.write_text(SINTER_HEADER + SINTER_ROW, encoding="utf-8")
    return source


async def assert_probe_and_validation(
    websocket: WebSocketClientProtocol, source: Path
) -> None:
    await websocket.send(
        json.dumps(
            {"type": "import_probe", "requestId": "probe", "source": "stats.csv"}
        )
    )
    probe = json.loads(await websocket.recv())
    supported = [item for item in probe["results"] if item["supported"]]
    assert supported[0]["adapterId"] == "sinter-csv"
    assert probe["sourceByteSize"] == source.stat().st_size
    assert probe["sourcePolicy"] == "copy"

    await websocket.send(
        json.dumps(
            {
                "type": "import_validate",
                "requestId": "validate",
                "source": "stats.csv",
                "adapterId": "sinter-csv",
                "mapping": {"fields": {}, "options": {}},
            }
        )
    )
    validation = json.loads(await websocket.recv())
    assert validation == {
        "type": "import_validation_result",
        "requestId": "validate",
        "valid": True,
        "issues": [],
        "sourceSha256": supported[0]["sourceSha256"],
        "provenanceId": validation["provenanceId"],
        "sourceByteSize": source.stat().st_size,
        "sourcePolicy": "copy",
    }


async def assert_sinter_preview(websocket: WebSocketClientProtocol) -> None:
    await websocket.send(
        json.dumps(
            {
                "type": "import_preview",
                "requestId": "preview",
                "source": "stats.csv",
                "adapterId": "sinter-csv",
                "mapping": {"fields": {}, "options": {}},
                "limit": 1,
            }
        )
    )
    preview = json.loads(await websocket.recv())
    assert preview["batches"] == [
        {
            "recordKind": "campaign_points",
            "recordCount": 1,
            "sequenceStart": 0,
            "sequenceEnd": 1,
            "segmentId": "campaign-points",
        }
    ]


async def import_sinter_session(websocket: WebSocketClientProtocol) -> None:
    await websocket.send(
        json.dumps(
            {
                "type": "import_start",
                "requestId": "import-1",
                "source": "stats.csv",
                "adapterId": "sinter-csv",
                "mapping": {"fields": {}, "options": {}},
                "sessionId": "campaign-1",
                "sessionKind": "simulation_campaign",
            }
        )
    )
    events = [json.loads(await websocket.recv()) for _ in range(2)]
    assert {event["type"] for event in events} == {"job_started", "job_complete"}
    completed = next(event for event in events if event["type"] == "job_complete")
    assert completed["recordsWritten"] == 1
    assert completed["partitionsWritten"] == 1
    assert completed["sourcePolicy"] == "copy"


async def assert_campaign_query(
    websocket: WebSocketClientProtocol, dataset_id: str
) -> None:
    await websocket.send(
        json.dumps(
            {
                "type": "query_start",
                "requestId": "query-1",
                "query": {
                    "requestId": "query-1",
                    "sessionId": "campaign-1",
                    "datasetId": dataset_id,
                    "tile": "table-page",
                    "selection": {
                        "primary": None,
                        "scope": [],
                        "timeWindow": None,
                        "source": "user",
                    },
                    "resolution": {"width": 64, "height": 32},
                    "filters": {"start": 0, "end": 10, "limit": 10},
                },
            }
        )
    )
    query_events: list[dict[str, object]] = []
    while not any(event["type"] in {"tile", "error"} for event in query_events):
        query_events.append(json.loads(await websocket.recv()))
    assert query_events[-1]["type"] == "tile"


@pytest.mark.asyncio
async def test_server_rejects_wrong_token(qec_data_server: QecDataServer) -> None:
    async with connect(qec_data_server.url) as websocket:
        await websocket.send(json.dumps({"type": "authenticate", "token": "wrong"}))
        with pytest.raises(ConnectionClosedError) as closed:
            await websocket.recv()
        assert closed.value.code == 4401


@pytest.mark.asyncio
async def test_server_rejects_late_authentication(
    qec_data_server: QecDataServer,
) -> None:
    async with connect(qec_data_server.url) as websocket:
        await asyncio.sleep(0.08)
        with pytest.raises(ConnectionClosedError) as closed:
            await websocket.recv()
        assert closed.value.code == 4401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "authentication",
    [
        "not-json",
        json.dumps({"type": "authenticate"}),
        json.dumps({"type": "authenticate", "token": TOKEN, "extra": True}),
        json.dumps({"type": "authenticate", "token": "x" * 1025}),
    ],
)
async def test_server_rejects_malformed_authentication(
    qec_data_server: QecDataServer, authentication: str
) -> None:
    async with connect(qec_data_server.url) as websocket:
        await websocket.send(authentication)
        with pytest.raises(ConnectionClosedError) as closed:
            await websocket.recv()
        assert closed.value.code == 4401


@pytest.mark.asyncio
async def test_server_accepts_token_then_returns_request_scoped_errors(
    qec_data_server: QecDataServer,
) -> None:
    async with connect(qec_data_server.url) as websocket:
        await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
        assert json.loads(await websocket.recv()) == {"type": "authenticated"}
        await websocket.send(
            json.dumps(
                {
                    "type": "session_list",
                    "requestId": "bad-list",
                    "cursor": None,
                    "limit": 0,
                }
            )
        )
        error = json.loads(await websocket.recv())
        assert error["type"] == "error"
        assert error["requestId"] == "bad-list"
        assert error["code"] == "invalid_request"

        await websocket.send(
            json.dumps(
                {"type": "job_cancel", "requestId": "cancel-1", "jobId": "other"}
            )
        )
        cancelled = json.loads(await websocket.recv())
        assert cancelled["type"] == "job_cancelled"
        assert cancelled["success"] is False

        await websocket.send(
            json.dumps(
                {
                    "type": "query_start",
                    "requestId": "query-outer",
                    "query": {"requestId": "query-inner"},
                }
            )
        )
        mismatch = json.loads(await websocket.recv())
        assert mismatch["code"] == "invalid_request"


@pytest.mark.asyncio
async def test_inbound_frame_above_cap_is_closed(
    qec_data_server: QecDataServer,
) -> None:
    async with connect(qec_data_server.url, max_size=None) as websocket:
        await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
        await websocket.recv()
        await websocket.send("x" * (MAX_FRAME_BYTES + 1))
        with pytest.raises(ConnectionClosedError) as closed:
            await websocket.recv()
        assert closed.value.code == 1009


@pytest.mark.asyncio
async def test_restart_invalidates_the_old_token(tmp_path: Path) -> None:
    first = QecDataServer(tmp_path, TOKEN, port=0)
    await first.start()
    port = int(first.url.rsplit(":", 1)[1])
    await first.stop()
    replacement_token = "cd" * 32
    second = QecDataServer(tmp_path, replacement_token, port=port)
    await second.start()
    try:
        async with connect(second.url) as websocket:
            await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
            with pytest.raises(ConnectionClosedError) as closed:
                await websocket.recv()
            assert closed.value.code == 4401
    finally:
        await second.stop()


def test_protocol_requires_exact_finite_bounded_requests() -> None:
    valid = json.dumps(
        {"type": "session_list", "requestId": "list-1", "cursor": None, "limit": 25}
    )
    request = parse_request(valid)
    assert request.message_type is MessageType.SESSION_LIST
    assert request.request_id == "list-1"

    invalid = (
        json.dumps(
            {
                "type": "session_list",
                "requestId": "r",
                "cursor": None,
                "limit": 1,
                "oops": 1,
            }
        ),
        '{"type":"session_list","requestId":"r","cursor":null,"limit":NaN}',
        json.dumps(
            {"type": "session_list", "requestId": "", "cursor": None, "limit": 1}
        ),
        json.dumps(
            {"type": "session_list", "requestId": "x" * 257, "cursor": None, "limit": 1}
        ),
        json.dumps(
            {"type": "session_list", "requestId": "r", "cursor": None, "limit": True}
        ),
    )
    for frame in invalid:
        with pytest.raises(ProtocolError) as raised:
            parse_request(frame)
        assert raised.value.code == "invalid_request"


def test_import_validate_request_has_an_exact_key_contract() -> None:
    frame = json.dumps(
        {
            "type": "import_validate",
            "requestId": "validate-1",
            "source": "stats.csv",
            "adapterId": "sinter-csv",
            "mapping": {"fields": {}, "options": {}},
        }
    )
    request = parse_request(frame)
    assert request.message_type is MessageType.IMPORT_VALIDATE

    with pytest.raises(ProtocolError, match="fields"):
        parse_request(frame.removesuffix("}") + ',"unexpected":true}')


def test_authentication_parser_never_includes_the_supplied_token_in_errors() -> None:
    secret = "very-sensitive-token"
    with pytest.raises(ProtocolError) as raised:
        parse_authentication(
            json.dumps({"type": "authenticate", "token": secret}), TOKEN
        )
    assert raised.value.code == "authentication_failed"
    assert secret not in str(raised.value)


def test_outbound_frames_are_capped_without_truncating_query_data() -> None:
    with pytest.raises(OutboundFrameTooLarge):
        encode_frame({"type": "tile", "data": "x" * MAX_FRAME_BYTES})

    refinement = query_requires_refinement_frame("query-1")
    assert len(refinement.encode("utf-8")) <= MAX_FRAME_BYTES
    assert json.loads(refinement) == {
        "type": "error",
        "requestId": "query-1",
        "code": "query_requires_refinement",
        "message": "Query result exceeds the 1 MiB frame limit; refine or paginate it.",
    }


@pytest.mark.asyncio
async def test_jobs_are_owner_scoped_and_disconnect_cleanup_cancels_all() -> None:
    registry = JobRegistry(max_jobs_per_owner=2)
    cancelled = asyncio.Event()

    async def waits_forever() -> None:
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    registry.start("owner-a", "job-1", waits_forever)
    await asyncio.sleep(0)
    assert not registry.cancel("owner-b", "job-1")
    assert registry.active_count("owner-a") == 1

    assert registry.cancel_owner("owner-a") == 1
    await asyncio.wait_for(cancelled.wait(), timeout=0.2)
    await registry.wait_owner("owner-a")
    assert registry.active_count("owner-a") == 0


@pytest.mark.asyncio
async def test_job_registry_enforces_per_connection_limit() -> None:
    registry = JobRegistry(max_jobs_per_owner=1)

    async def waits_forever() -> None:
        await asyncio.Future()

    registry.start("owner", "job-1", waits_forever)
    with pytest.raises(ProtocolError) as raised:
        registry.start("owner", "job-2", waits_forever)
    assert raised.value.code == "job_limit_exceeded"
    registry.cancel_owner("owner")
    await registry.wait_owner("owner")


@pytest.mark.asyncio
async def test_job_registry_rejects_invalid_limit_duplicate_and_runs_cancel_callback() -> (
    None
):
    with pytest.raises(ValueError):
        JobRegistry(max_jobs_per_owner=0)
    registry = JobRegistry()
    callback_called = False

    async def waits_forever() -> None:
        await asyncio.Future()

    def cancelled() -> None:
        nonlocal callback_called
        callback_called = True

    registry.start("owner", "job", waits_forever, cancel_callback=cancelled)
    with pytest.raises(ProtocolError) as duplicate:
        registry.start("owner", "job", waits_forever)
    assert duplicate.value.code == "job_already_active"
    assert registry.cancel("owner", "job")
    assert callback_called
    await registry.wait_owner("owner")
    await registry.wait_owner("nobody")


@pytest.mark.asyncio
async def test_session_list_is_paginated_and_bounded(tmp_path: Path) -> None:
    sessions = tmp_path / "qec-data" / "sessions"
    create_storage(sessions, "session-a")
    create_storage(sessions, "session-b")
    create_storage(sessions, "session-c")
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with connect(server.url) as websocket:
            await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
            assert json.loads(await websocket.recv()) == {"type": "authenticated"}
            await websocket.send(
                json.dumps(
                    {
                        "type": "session_list",
                        "requestId": "page-1",
                        "cursor": None,
                        "limit": 2,
                    }
                )
            )
            first = json.loads(await websocket.recv())
            assert [item["session_id"] for item in first["sessions"]] == [
                "session-a",
                "session-b",
            ]
            assert first["nextCursor"] == "session-b"

            await websocket.send(
                json.dumps(
                    {
                        "type": "session_list",
                        "requestId": "page-2",
                        "cursor": first["nextCursor"],
                        "limit": 2,
                    }
                )
            )
            second = json.loads(await websocket.recv())
            assert [item["session_id"] for item in second["sessions"]] == ["session-c"]
            assert second["nextCursor"] is None
    finally:
        await server.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "source", ["../outside.csv", "/tmp/outside.csv", "qec-data/x.csv"]
)
async def test_import_sources_cannot_escape_or_read_canonical_data(
    tmp_path: Path, source: str
) -> None:
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with connect(server.url) as websocket:
            await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
            await websocket.recv()
            await websocket.send(
                json.dumps(
                    {"type": "import_probe", "requestId": "probe-1", "source": source}
                )
            )
            error = json.loads(await websocket.recv())
            assert error["type"] == "error"
            assert error["code"] == "source_not_authorized"
    finally:
        await server.stop()


@pytest.mark.asyncio
async def test_import_source_symlink_is_rejected(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside.csv"
    outside.write_text("not trusted", encoding="utf-8")
    (tmp_path / "linked.csv").symlink_to(outside)
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with connect(server.url) as websocket:
            await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
            await websocket.recv()
            await websocket.send(
                json.dumps(
                    {
                        "type": "import_probe",
                        "requestId": "probe-link",
                        "source": "linked.csv",
                    }
                )
            )
            error = json.loads(await websocket.recv())
            assert error["code"] == "source_not_authorized"
    finally:
        await server.stop()
        outside.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_probe_and_preview_dispatch_registered_adapter(tmp_path: Path) -> None:
    source = write_sinter_source(tmp_path)
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with authenticated(server) as websocket:
            await assert_probe_and_validation(websocket, source)
            await assert_sinter_preview(websocket)
    finally:
        await server.stop()
        await server.stop()


@pytest.mark.asyncio
async def test_preview_refuses_invalid_mapping_with_stable_error(
    tmp_path: Path,
) -> None:
    source = tmp_path / "capture.csv"
    source.write_text("sequence,bits\n0,00\n", encoding="utf-8")
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with authenticated(server) as websocket:
            await websocket.send(
                json.dumps(
                    {
                        "type": "import_validate",
                        "requestId": "invalid-validation",
                        "source": "capture.csv",
                        "adapterId": "tabular",
                        "mapping": {"fields": {}, "options": {}},
                    }
                )
            )
            validation = json.loads(await websocket.recv())
            assert validation["valid"] is False
            assert validation["sourceByteSize"] == source.stat().st_size
            assert validation["sourcePolicy"] == "copy"
            assert set(validation["issues"][0]) == {
                "code",
                "message",
                "severity",
                "field",
            }
            assert validation["issues"][0]["severity"] == "error"

            await websocket.send(
                json.dumps(
                    {
                        "type": "import_preview",
                        "requestId": "invalid-preview",
                        "source": "capture.csv",
                        "adapterId": "tabular",
                        "mapping": {"fields": {}, "options": {}},
                        "limit": 10,
                    }
                )
            )
            error = json.loads(await websocket.recv())
            assert error["requestId"] == "invalid-preview"
            assert error["code"] == "import_validation_failed"
    finally:
        await server.stop()


@pytest.mark.asyncio
async def test_sinter_import_copies_source_and_finishes_complete(
    tmp_path: Path,
) -> None:
    source = write_sinter_source(tmp_path)
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with authenticated(server) as websocket:
            await import_sinter_session(websocket)
            storage = SessionStorage.open(
                tmp_path / "qec-data" / "sessions", "campaign-1"
            )
            dataset_id = QecCatalog(storage).synchronize()[0].dataset_id
            await assert_campaign_query(websocket, dataset_id)

        copied = tmp_path / "qec-data" / "sources" / "campaign-1" / "stats.csv"
        assert copied.read_bytes() == source.read_bytes()
        manifest = loads_canonical_json(
            (
                tmp_path / "qec-data" / "sessions" / "campaign-1" / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        assert manifest["status"] == "complete"
    finally:
        await server.stop()


@pytest.mark.parametrize(
    "terminal_status",
    [SessionStatus.COMPLETE, SessionStatus.PARTIAL, SessionStatus.FAILED],
)
def test_import_session_finalization_is_atomic_and_never_leaves_importing(
    tmp_path: Path, terminal_status: SessionStatus
) -> None:
    importing = replace(
        sample_session(),
        status=SessionStatus.IMPORTING,
        started_at=QualifiedText(sample_session().created_at, ValueStatus.MEASURED),
    )
    session_storage = SessionStorage.create(tmp_path, importing, sample_identity())
    finalize_session_manifest(session_storage.session_root, terminal_status)

    manifest = loads_canonical_json(
        (session_storage.session_root / "manifest.json").read_text(encoding="utf-8")
    )
    finalized = session_from_mapping(manifest)
    assert finalized.status is terminal_status
    assert finalized.completed_at.value is not None


def test_successful_finalization_publishes_committed_segments_in_manifest(
    tmp_path: Path,
) -> None:
    importing = replace(
        sample_session(),
        status=SessionStatus.IMPORTING,
        started_at=QualifiedText(sample_session().created_at, ValueStatus.MEASURED),
    )
    storage = SessionStorage.create(tmp_path, importing, sample_identity())
    storage.append_batch(sample_batch())
    storage.commit_segment("segment-0001")

    finalize_session_manifest(storage.session_root, SessionStatus.COMPLETE)

    manifest = session_from_mapping(
        loads_canonical_json(
            (storage.session_root / "manifest.json").read_text(encoding="utf-8")
        )
    )
    journal = loads_canonical_json(
        (storage.session_root / "journal.json").read_text(encoding="utf-8")
    )
    assert manifest.segments == ("segment-0001",)
    assert set(manifest.segments) == {
        str(segment["segment_id"]) for segment in journal["segments"]
    }


@pytest.mark.asyncio
async def test_server_reports_port_conflict_without_touching_listener(
    tmp_path: Path,
) -> None:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    server = QecDataServer(tmp_path, TOKEN, port=port)
    try:
        with pytest.raises(PortInUseError):
            await server.start()
        assert listener.fileno() >= 0
    finally:
        listener.close()


@pytest.mark.parametrize(
    "project,token,keywords",
    [
        (Path("."), "", {"port": 0}),
        (Path("."), TOKEN, {"host": "localhost", "port": 0}),
        (Path("."), TOKEN, {"port": -1}),
        (Path("."), TOKEN, {"port": 0, "authentication_timeout": 0}),
    ],
)
def test_server_constructor_rejects_invalid_boundaries(
    project: Path, token: str, keywords: dict[str, object]
) -> None:
    with pytest.raises(ValueError):
        QecDataServer(project, token, **keywords)
