"""qec_explain message handler: success, validation and visible failures."""

from __future__ import annotations

import asyncio
import json

import stim

from kernel.qec import explain_handler
from kernel.qec.explain_handler import MAX_CIRCUIT_CHARS, handle_qec_explain


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))


def _call(msg: dict) -> list[dict]:
    socket = FakeSocket()
    asyncio.run(handle_qec_explain(socket, msg))
    return socket.sent


def test_both_analyses_returned_with_request_id():
    text = str(stim.Circuit.generated("repetition_code:memory", distance=3, rounds=3,
                                      after_clifford_depolarization=0.001))
    (reply,) = _call({"type": "qec_explain", "circuit_text": text, "request_id": "r1"})
    assert reply["type"] == "qec_explain_result"
    assert reply["request_id"] == "r1"
    assert reply["data"]["nondeterministic"]["status"] == "ok"
    assert reply["data"]["min_weight"]["weight"] == 3


def test_single_analysis_only_runs_that_one():
    (reply,) = _call({"circuit_text": "R 0\nH 0\nM 0\nDETECTOR rec[-1]\n",
                      "analysis": "nondeterministic"})
    assert set(reply["data"]) == {"nondeterministic"}
    assert reply["data"]["nondeterministic"]["status"] == "nondeterministic"


def test_missing_circuit_text_is_a_visible_error():
    (reply,) = _call({"type": "qec_explain"})
    assert reply["type"] == "error"
    assert reply["phase"] == "qec_explain"
    assert reply["code"] == "qec_explain_invalid"


def test_unknown_analysis_is_a_visible_error():
    (reply,) = _call({"circuit_text": "R 0\n", "analysis": "fix_it"})
    assert reply["type"] == "error"
    assert "fix_it" in reply["message"]


def test_oversized_circuit_is_rejected():
    (reply,) = _call({"circuit_text": "H 0\n" * (MAX_CIRCUIT_CHARS // 4 + 1)})
    assert reply["code"] == "qec_explain_too_large"


def test_unexpected_failure_is_reported_not_swallowed(monkeypatch):
    def boom(_text):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(explain_handler, "explain_nondeterministic", boom)
    (reply,) = _call({"circuit_text": "R 0\n", "request_id": "x"})
    assert reply["type"] == "error"
    assert reply["code"] == "qec_explain_failed"
    assert "kaboom" in reply["message"]
    assert reply["request_id"] == "x"


def test_server_routes_qec_explain():
    from pathlib import Path

    source = (Path(explain_handler.__file__).parents[1] / "server.py").read_text()
    assert 'msg_type == "qec_explain"' in source
