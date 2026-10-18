"""hardware_list_backends must not block the kernel's event loop."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import threading
from unittest import mock

with mock.patch.dict(os.environ, {
    "NUCLEI_DISABLE_CRED_STORE": "1",
    "NUCLEI_DATA_DIR": tempfile.mkdtemp(prefix="nuclei-server-test-"),
}):
    import kernel.server as server


class _FakeSocket:
    def __init__(self, frames: list[str]) -> None:
        self._frames = frames
        self.sent: list[dict] = []

    def __aiter__(self):
        async def gen():
            for frame in self._frames:
                yield frame
        return gen()

    async def send(self, payload: str) -> None:
        self.sent.append(json.loads(payload))


def test_list_backends_runs_off_the_event_loop() -> None:
    loop_thread: dict[str, int] = {}
    worker_thread: dict[str, int] = {}

    def slow_list(provider):
        worker_thread["id"] = threading.get_ident()
        return []

    async def run() -> _FakeSocket:
        loop_thread["id"] = threading.get_ident()
        socket = _FakeSocket([json.dumps({"type": "hardware_list_backends", "provider": "ibm"})])
        with mock.patch.object(server.hardware_manager, "list_backends", side_effect=slow_list):
            await server.handle_message(socket)
        return socket

    socket = asyncio.run(run())
    assert worker_thread["id"] != loop_thread["id"]
    assert socket.sent == [{"type": "hardware_backends", "backends": []}]
