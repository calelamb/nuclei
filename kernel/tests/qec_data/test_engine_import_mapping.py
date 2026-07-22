from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
import pytest_asyncio
from websockets.legacy.client import WebSocketClientProtocol, connect

from kernel.qec_data.adapters.stim_results import StimResultsAdapter
from kernel.qec_data.server import QecDataServer


TOKEN = "ab" * 32


@pytest_asyncio.fixture
async def qec_data_server(tmp_path: Path):
    server = QecDataServer(project_root=tmp_path, token=TOKEN, port=0)
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


def _context_request(
    operation: str, context_name: str, context_path: str
) -> dict[str, object]:
    request: dict[str, object] = {
        "type": f"import_{operation}",
        "requestId": f"context-{operation}",
        "source": "shots.dets",
        "adapterId": "stim-results",
        "mapping": {
            "fields": {},
            "options": {
                context_name: context_path,
                "detector_count": 1,
                "observable_count": 0,
            },
        },
    }
    if operation == "preview":
        return {**request, "limit": 1}
    if operation == "start":
        return {
            **request,
            "sessionId": "context-import",
            "sessionKind": "hardware_import",
        }
    return request


@pytest.mark.asyncio
@pytest.mark.parametrize("context_name", ["circuit_path", "dem_path"])
@pytest.mark.parametrize("context_path", ["context.stim", "/tmp/outside.stim"])
@pytest.mark.parametrize("operation", ["validate", "preview", "start"])
async def test_engine_rejects_stim_secondary_context_before_adapter_access(
    qec_data_server: QecDataServer,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    context_name: str,
    context_path: str,
    operation: str,
) -> None:
    (tmp_path / "shots.dets").write_text("shot D0\n", encoding="ascii")
    adapter_calls: list[str] = []

    def reject_adapter_call(*_args: object, **_kwargs: object) -> None:
        adapter_calls.append("called")
        raise AssertionError("adapter must not receive unbacked context options")

    monkeypatch.setattr(StimResultsAdapter, "validate", reject_adapter_call)
    monkeypatch.setattr(StimResultsAdapter, "preview", reject_adapter_call)
    monkeypatch.setattr(StimResultsAdapter, "import_batches", reject_adapter_call)
    request = _context_request(operation, context_name, context_path)
    async with authenticated(qec_data_server) as websocket:
        await websocket.send(json.dumps(request))
        response = json.loads(await websocket.recv())

    assert response["type"] == "error"
    assert response["code"] == "invalid_request"
    assert "not capability-backed" in response["message"]
    assert "detector_count and observable_count" in response["message"]
    assert adapter_calls == []


@pytest.mark.asyncio
async def test_engine_stim_validation_accepts_explicit_widths(
    qec_data_server: QecDataServer, tmp_path: Path
) -> None:
    (tmp_path / "shots.dets").write_text("shot D0\n", encoding="ascii")
    request = {
        "type": "import_validate",
        "requestId": "explicit-widths",
        "source": "shots.dets",
        "adapterId": "stim-results",
        "mapping": {
            "fields": {},
            "options": {"detector_count": 1, "observable_count": 0},
        },
    }
    async with authenticated(qec_data_server) as websocket:
        await websocket.send(json.dumps(request))
        response = json.loads(await websocket.recv())

    assert response["type"] == "import_validation_result"
    assert response["valid"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("options", [{"detector_count": 1}, {"observable_count": 0}])
async def test_engine_rejects_missing_stim_width_before_adapter_access(
    qec_data_server: QecDataServer,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    options: dict[str, int],
) -> None:
    (tmp_path / "shots.dets").write_text("shot D0\n", encoding="ascii")
    adapter_calls: list[str] = []
    monkeypatch.setattr(
        StimResultsAdapter,
        "validate",
        lambda *_args, **_kwargs: adapter_calls.append("called"),
    )
    request = {
        "type": "import_validate",
        "requestId": "missing-width",
        "source": "shots.dets",
        "adapterId": "stim-results",
        "mapping": {"fields": {}, "options": options},
    }
    async with authenticated(qec_data_server) as websocket:
        await websocket.send(json.dumps(request))
        response = json.loads(await websocket.recv())

    assert response["type"] == "error"
    assert response["code"] == "invalid_request"
    assert "detector_count and observable_count" in response["message"]
    assert adapter_calls == []
