from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from dataclasses import replace
from pathlib import Path

import pytest
from websockets.exceptions import ConnectionClosedError
from websockets.legacy.client import connect

import kernel.qec_data.server as server_module
from kernel.qec_data.adapters.sinter_csv import SinterCsvAdapter
from kernel.qec_data.protocol import (
    MAX_FRAME_BYTES,
    OutboundFrameTooLarge,
    ProtocolError,
)
from kernel.qec_data.queries import QueryCancelled
from kernel.qec_data.server import QecDataServer


TOKEN = "ab" * 32
SINTER_SOURCE = (
    "shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts\n"
    '100,3,0,1.25,pymatching,strong-a,"{""d"":3}",{}\n'
)


async def authenticate(websocket) -> None:
    await websocket.send(json.dumps({"type": "authenticate", "token": TOKEN}))
    assert json.loads(await websocket.recv()) == {"type": "authenticated"}


def install_interruptible_query(
    monkeypatch: pytest.MonkeyPatch,
    started: threading.Event,
    interrupted: threading.Event,
    release: threading.Event,
) -> None:
    class FakeCatalog:
        def __init__(self, _storage) -> None:
            pass

        def synchronize(self) -> None:
            pass

    class InterruptibleEngine:
        def __init__(self, _catalog) -> None:
            pass

        def execute(self, _query, _token):
            started.set()
            release.wait(timeout=1)
            if interrupted.is_set():
                raise QueryCancelled("interrupted")
            return iter(())

        def cancel(self, _request_id: str) -> bool:
            interrupted.set()
            release.set()
            return True

    monkeypatch.setattr(server_module.SessionStorage, "open", lambda *_args: object())
    monkeypatch.setattr(server_module, "QecCatalog", FakeCatalog)
    monkeypatch.setattr(server_module, "QecQueryEngine", InterruptibleEngine)


@pytest.mark.asyncio
async def test_oversized_first_frame_is_rejected_as_authentication(
    tmp_path: Path,
) -> None:
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with connect(server.url, max_size=None) as websocket:
            await websocket.send("x" * (MAX_FRAME_BYTES + 1))
            with pytest.raises(ConnectionClosedError) as closed:
                await websocket.recv()
            assert closed.value.code == 4401
    finally:
        await server.stop()


@pytest.mark.asyncio
async def test_dispatch_errors_keep_the_parsed_request_id(tmp_path: Path) -> None:
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with connect(server.url) as websocket:
            await authenticate(websocket)
            await websocket.send(
                json.dumps(
                    {
                        "type": "import_probe",
                        "requestId": "missing-source",
                        "source": "missing.csv",
                    }
                )
            )
            error = json.loads(await websocket.recv())
            assert error["requestId"] == "missing-source"
            assert error["code"] == "source_not_authorized"
    finally:
        await server.stop()


@pytest.mark.asyncio
async def test_oversized_dispatch_response_keeps_the_request_id(tmp_path: Path) -> None:
    class OversizedConnection:
        def __init__(self) -> None:
            self.responses: list[str] = []

        async def send(self, value) -> None:
            if not self.responses:
                self.responses.append("attempted")
                raise OutboundFrameTooLarge()
            self.responses.append(value)

    server = QecDataServer(tmp_path, TOKEN, port=0)
    connection = OversizedConnection()
    frame = json.dumps(
        {
            "type": "session_list",
            "requestId": "large-response",
            "cursor": None,
            "limit": 1,
        }
    )

    await server._handle_frame(connection, frame)  # type: ignore[arg-type]

    error = json.loads(connection.responses[-1])
    assert error["requestId"] == "large-response"
    assert error["code"] == "response_too_large"


def test_import_session_id_and_canonical_source_are_cross_platform_safe(
    tmp_path: Path,
) -> None:
    server = QecDataServer(tmp_path, TOKEN, port=0)
    with pytest.raises(ProtocolError, match="Canonical data"):
        server._authorized_source("QEC-DATA/secret.csv")

    frame = json.dumps(
        {
            "type": "import_start",
            "requestId": "windows-session",
            "source": "stats.csv",
            "adapterId": "sinter-csv",
            "mapping": {},
            "sessionId": "..\\escaped",
            "sessionKind": "simulation_campaign",
        }
    )
    with pytest.raises(ProtocolError) as invalid:
        server_module.parse_request(frame)
    assert invalid.value.request_id == "windows-session"


def test_import_copies_the_validated_snapshot_not_later_source_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "stats.csv"
    source.write_text(SINTER_SOURCE, encoding="utf-8")
    initial_bytes = source.read_bytes()
    original_validate = SinterCsvAdapter.validate

    def mutate_original_after_validation(adapter, snapshot, mapping):
        report = original_validate(adapter, snapshot, mapping)
        source.write_text(SINTER_SOURCE.replace("100,3", "200,9"), encoding="utf-8")
        return report

    monkeypatch.setattr(SinterCsvAdapter, "validate", mutate_original_after_validation)
    server = QecDataServer(tmp_path, TOKEN, port=0)
    payload = {
        "source": "stats.csv",
        "adapterId": "sinter-csv",
        "mapping": {},
        "sessionId": "campaign-snapshot",
        "sessionKind": "simulation_campaign",
    }

    prepared = server._prepare_import(payload)

    copied = prepared[2]
    assert copied.read_bytes() == initial_bytes
    assert (
        hashlib.sha256(copied.read_bytes()).hexdigest()
        == prepared[0]._identity.source_sha256[0]
    )


def test_import_hash_mismatch_cleans_the_untrusted_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "stats.csv").write_text(SINTER_SOURCE, encoding="utf-8")
    original_validate = SinterCsvAdapter.validate

    def lie_about_hash(adapter, snapshot, mapping):
        return replace(
            original_validate(adapter, snapshot, mapping), source_sha256="0" * 64
        )

    monkeypatch.setattr(SinterCsvAdapter, "validate", lie_about_hash)
    server = QecDataServer(tmp_path, TOKEN, port=0)
    payload = {
        "source": "stats.csv",
        "adapterId": "sinter-csv",
        "mapping": {},
        "sessionId": "campaign-mismatch",
        "sessionKind": "simulation_campaign",
    }

    with pytest.raises(ProtocolError, match="changed"):
        server._prepare_import(payload)
    assert not (tmp_path / "qec-data/sources/campaign-mismatch").exists()


def test_import_collision_never_deletes_the_existing_source(tmp_path: Path) -> None:
    source = tmp_path / "stats.csv"
    source.write_text(SINTER_SOURCE, encoding="utf-8")
    server = QecDataServer(tmp_path, TOKEN, port=0)
    payload = {
        "source": "stats.csv",
        "adapterId": "sinter-csv",
        "mapping": {},
        "sessionId": "campaign-existing",
        "sessionKind": "simulation_campaign",
    }
    first = server._prepare_import(payload)[2]

    with pytest.raises(FileExistsError):
        server._prepare_import(payload)

    assert first.read_bytes() == source.read_bytes()


@pytest.mark.asyncio
async def test_query_cancel_interrupts_the_active_query_engine(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = threading.Event()
    interrupted = threading.Event()
    release = threading.Event()
    install_interruptible_query(monkeypatch, started, interrupted, release)
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with connect(server.url) as websocket:
            await authenticate(websocket)
            query = {"requestId": "query-live", "sessionId": "session"}
            await websocket.send(
                json.dumps(
                    {"type": "query_start", "requestId": "query-live", "query": query}
                )
            )
            assert json.loads(await websocket.recv())["type"] == "job_started"
            assert await asyncio.to_thread(started.wait, 0.5)
            await websocket.send(
                json.dumps(
                    {
                        "type": "query_cancel",
                        "requestId": "cancel-live",
                        "queryRequestId": "query-live",
                    }
                )
            )
            assert json.loads(await websocket.recv())["type"] == "query_cancelled"
            assert await asyncio.to_thread(interrupted.wait, 0.2)
    finally:
        release.set()
        await server.stop()
