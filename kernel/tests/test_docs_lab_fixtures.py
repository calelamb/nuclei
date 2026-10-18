"""Replay the Quantum AI Lab streaming fixtures against the real kernel handlers.

``docs-site/fixtures/lab_*.request.json`` (one synchronous reply) are replayed
by test_docs_fixtures.py. The Lab's *job* messages stream several responses
over seconds (``trainability_start``, ``discovery_evaluate``,
``discovery_audit``, ``discovery_conjecture_test``), so they are replayed here:

    docs-site/fixtures/lab/NAME.stream.json
    {
      "request":      {...},
      "until":        "<terminal response type>",
      "ignore_types": ["<throttled progress type>", ...],
      "responses":    [...]            # the exact ordered stream, minus ignored types
    }

The harness sends the request, keeps the connection open until the terminal
type arrives (or a generous deadline passes), then compares the stream with
the same matcher as test_docs_fixtures.py (``<any>``, ``<approx:X:TOL>``).
Progress messages are throttled by wall clock, so their count is not fixed;
fixtures list them in ``ignore_types`` and leave them out of ``responses``.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from unittest import mock

import pytest

with mock.patch.dict(os.environ, {
    "NUCLEI_DISABLE_CRED_STORE": "1",
    "NUCLEI_DATA_DIR": tempfile.mkdtemp(prefix="nuclei-docs-lab-fixtures-"),
}):
    import kernel.server as server

from .test_docs_fixtures import assert_matches

REPO_ROOT = Path(__file__).resolve().parents[2]
LAB_FIXTURES_DIR = REPO_ROOT / "docs-site" / "fixtures" / "lab"
STREAM_FIXTURES = sorted(LAB_FIXTURES_DIR.glob("*.stream.json"))
DEADLINE_S = 600  # candidate sandboxes are slow on a loaded machine


class StreamingSocket:
    """Sends one request, then stays open until the terminal response arrives."""

    def __init__(self, request: dict, until: str):
        self._request = request
        self._until = until
        self._sent = False
        self.received: list[dict] = []
        self._done = asyncio.Event()

    def __aiter__(self):
        return self

    async def __anext__(self) -> str:
        if not self._sent:
            self._sent = True
            return json.dumps(self._request)
        await asyncio.wait_for(self._done.wait(), DEADLINE_S)
        raise StopAsyncIteration

    async def send(self, text: str) -> None:
        message = json.loads(text)
        self.received.append(message)
        if message.get("type") == self._until or message.get("type") == "error":
            self._done.set()


def test_stream_fixture_inventory_nonempty():
    assert STREAM_FIXTURES, f"no *.stream.json fixtures in {LAB_FIXTURES_DIR}"


@pytest.mark.parametrize("path", STREAM_FIXTURES, ids=lambda p: p.name.replace(".stream.json", ""))
def test_lab_stream_fixture(path: Path):
    pytest.importorskip("qiskit")
    pytest.importorskip("numpy")
    fixture = json.loads(path.read_text())
    ignore = set(fixture.get("ignore_types", []))
    socket = StreamingSocket(fixture["request"], fixture["until"])
    asyncio.run(server.handle_message(socket))

    actual = [m for m in socket.received if m.get("type") not in ignore]
    expected = fixture["responses"]
    assert [m.get("type") for m in actual] == [m.get("type") for m in expected], (
        f"{path.name}: response sequence differs from the documented stream"
    )
    for i, (exp, act) in enumerate(zip(expected, actual)):
        assert_matches(exp, act, path=f"responses[{i}]")
