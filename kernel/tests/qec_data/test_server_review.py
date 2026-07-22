from __future__ import annotations

import asyncio
import hashlib
import json
import os
import threading
from dataclasses import replace
from pathlib import Path

import pytest
from websockets.exceptions import ConnectionClosedError
from websockets.legacy.client import connect

import kernel.qec_data.server as server_module
import kernel.qec_data.source_security as source_security
from kernel.qec_data.adapters.sinter_csv import SinterCsvAdapter
from kernel.qec_data.model_codecs import loads_canonical_json
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
            protocols = server._server.websockets  # type: ignore[union-attr]
            assert next(iter(protocols)).max_size == MAX_FRAME_BYTES
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
async def test_mutated_canonical_snapshot_can_never_complete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "stats.csv").write_text(SINTER_SOURCE, encoding="utf-8")
    server = QecDataServer(tmp_path, TOKEN, port=0)
    original_batches = SinterCsvAdapter.import_batches
    observed_shots: list[int] = []

    def mutate_restore_then_read(adapter, source, mapping):
        copied = server._active_test_copy
        cached = tuple(original_batches(adapter, source, mapping))
        os.chmod(copied, 0o600)
        copied.write_text(SINTER_SOURCE.replace("100,3", "200,9"), encoding="utf-8")
        try:
            batches = tuple(original_batches(adapter, source, mapping))
        finally:
            copied.write_text(SINTER_SOURCE, encoding="utf-8")
            os.chmod(copied, 0o400)
        disguised = tuple(
            replace(
                batch,
                payload=replace(
                    batch.payload, provenance_id=cached[index].payload.provenance_id
                ),
                source_spans=cached[index].source_spans,
            )
            for index, batch in enumerate(batches)
        )
        observed_shots.extend(batch.payload.records[0].shots for batch in disguised)
        return iter(disguised)

    original_prepare = server._prepare_import

    def remember_copy(payload):
        prepared = original_prepare(payload)
        server._active_test_copy = prepared[2]
        return prepared

    monkeypatch.setattr(SinterCsvAdapter, "import_batches", mutate_restore_then_read)
    server._prepare_import = remember_copy  # type: ignore[method-assign]
    await server.start()
    try:
        async with connect(server.url) as websocket:
            await authenticate(websocket)
            await websocket.send(json.dumps(_import_request("mutated-snapshot")))
            events = [json.loads(await websocket.recv()) for _ in range(2)]
        assert any(event["type"] == "job_complete" for event in events)
        assert observed_shots == [100]
        manifest = loads_canonical_json(
            (tmp_path / "qec-data/sessions/mutated-snapshot/manifest.json").read_text()
        )
        assert manifest["status"] == "complete"
    finally:
        await server.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation", ["import_probe", "import_validate", "import_preview"]
)
async def test_adapter_operations_use_a_snapshot_across_ancestor_swaps(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    source_dir = tmp_path / "incoming"
    source_dir.mkdir()
    source = source_dir / "stats.csv"
    source.write_text(SINTER_SOURCE, encoding="utf-8")
    expected_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "stats.csv").write_text(
        SINTER_SOURCE.replace("100,3", "999,8"), encoding="utf-8"
    )
    original = getattr(SinterCsvAdapter, _adapter_method(operation))
    swapped = False

    def swap_then_read(adapter, snapshot, *args):
        nonlocal swapped
        assert snapshot.is_capability_source
        if not swapped:
            source_dir.rename(tmp_path / "incoming-original")
            source_dir.symlink_to(outside, target_is_directory=True)
            swapped = True
        return original(adapter, snapshot, *args)

    monkeypatch.setattr(SinterCsvAdapter, _adapter_method(operation), swap_then_read)
    response = await _perform_import_operation(tmp_path, operation)
    assert _response_source_hash(response, operation) == expected_hash


def test_destination_swap_cannot_redirect_canonical_copy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "stats.csv").write_text(SINTER_SOURCE, encoding="utf-8")
    outside = tmp_path / "outside"
    outside.mkdir()
    server = QecDataServer(tmp_path, TOKEN, port=0)
    real_open = source_security._open_project_file

    def swap_destination(project_root, parts):
        descriptor = real_open(project_root, parts)
        sources = tmp_path / "qec-data/sources"
        sources.rename(tmp_path / "sources-original")
        sources.symlink_to(outside, target_is_directory=True)
        return descriptor

    monkeypatch.setattr(source_security, "_open_project_file", swap_destination)
    with pytest.raises(Exception):
        server._prepare_import(_import_payload("destination-swap"))
    assert not tuple(outside.rglob("*"))


def test_child_identity_rejects_a_replaced_project_namespace(tmp_path: Path) -> None:
    identity = tmp_path.stat().st_dev, tmp_path.stat().st_ino
    moved = tmp_path.with_name(f"{tmp_path.name}-original")
    tmp_path.rename(moved)
    tmp_path.mkdir()
    try:
        with pytest.raises(ProtocolError) as raised:
            QecDataServer(
                tmp_path,
                TOKEN,
                port=0,
                expected_project_identity=identity,
            )
        assert raised.value.code == "project_identity_changed"
    finally:
        tmp_path.rmdir()
        moved.rename(tmp_path)


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


def _import_payload(session_id: str) -> dict[str, object]:
    return {
        "source": "stats.csv",
        "adapterId": "sinter-csv",
        "mapping": {},
        "sessionId": session_id,
        "sessionKind": "simulation_campaign",
    }


def _import_request(session_id: str) -> dict[str, object]:
    return {
        "type": "import_start",
        "requestId": session_id,
        **_import_payload(session_id),
    }


def _adapter_method(operation: str) -> str:
    return "probe" if operation == "import_probe" else "validate"


async def _perform_import_operation(
    tmp_path: Path, operation: str
) -> dict[str, object]:
    server = QecDataServer(tmp_path, TOKEN, port=0)
    await server.start()
    try:
        async with connect(server.url) as websocket:
            await authenticate(websocket)
            request: dict[str, object] = {
                "type": operation,
                "requestId": operation,
                "source": "incoming/stats.csv",
            }
            if operation != "import_probe":
                request |= {
                    "adapterId": "sinter-csv",
                    "mapping": {},
                }
            if operation == "import_preview":
                request["limit"] = 1
            await websocket.send(json.dumps(request))
            return json.loads(await websocket.recv())
    finally:
        await server.stop()


def _response_source_hash(response: dict[str, object], operation: str) -> str:
    if operation == "import_probe":
        results = response["results"]
        assert isinstance(results, list)
        supported = next(item for item in results if item["adapterId"] == "sinter-csv")
        return supported["sourceSha256"]
    return response["sourceSha256"]
