"""CR-M4 (kernel side): optional ``request_id`` echo on every sync Lab request, replies and errors."""

from __future__ import annotations

import asyncio

import pytest

pytest.importorskip("qiskit")

from kernel.lab_protocol import request_id_problem, valid_request_id, with_request_id  # noqa: E402
from kernel.tests._trainability_job_helpers import QISKIT_CODE, connection  # noqa: E402

GOOD_PROGRAM = "def build():\n    return 1\n"

# (request, reply type, request that makes the same handler fail, error phase)
CASES = {
    "trainability_inspect": ({"type": "trainability_inspect", "code": QISKIT_CODE}, "trainability_inspected",
                             {"type": "trainability_inspect", "code": ""}, "trainability"),
    "trainability_lint": ({"type": "trainability_lint", "code": QISKIT_CODE}, "trainability_lint_result",
                          {"type": "trainability_lint", "code": 7}, "trainability"),
    "discovery_mutate": ({"type": "discovery_mutate", "program": GOOD_PROGRAM, "seed": 1, "count": 1},
                         "discovery_mutations", {"type": "discovery_mutate", "program": "", "seed": 1}, "discovery"),
    "discovery_evaluators": ({"type": "discovery_evaluators"}, "discovery_evaluators_result", None, "discovery"),
    "discovery_conjecture_schema": ({"type": "discovery_conjecture_schema"}, "discovery_conjecture_schema_result",
                                    None, "discovery"),
}


async def ask(message: dict, reply_type: str) -> dict:
    async with connection() as ws:
        ws.push(message)
        return (await ws.wait_for(lambda m: m.get("type") in (reply_type, "error"), 60))[0]


@pytest.mark.parametrize("name", sorted(CASES))
def test_reply_echoes_request_id(name):
    request, reply_type, _, _ = CASES[name]
    reply = asyncio.run(ask({**request, "request_id": "req:42.a-b_c"}, reply_type))
    assert reply["type"] == reply_type and reply["request_id"] == "req:42.a-b_c"


@pytest.mark.parametrize("name", sorted(CASES))
def test_no_id_in_means_no_id_out(name):
    request, reply_type, _, _ = CASES[name]
    reply = asyncio.run(ask(request, reply_type))
    assert reply["type"] == reply_type and "request_id" not in reply


@pytest.mark.parametrize("name", [n for n in sorted(CASES) if CASES[n][2] is not None])
def test_errors_caused_by_the_request_echo_the_id(name):
    _, _, failing, phase = CASES[name]
    reply = asyncio.run(ask({**failing, "request_id": "e-1"}, "never"))
    assert reply["type"] == "error" and reply["phase"] == phase and reply["request_id"] == "e-1"


@pytest.mark.parametrize("name", sorted(CASES))
@pytest.mark.parametrize("bad", ["", "x" * 65, "has space", "semi;colon", 7, ["a"], "emoji☃"])
def test_malformed_request_id_is_rejected_and_not_echoed(name, bad):
    request, reply_type, _, phase = CASES[name]
    reply = asyncio.run(ask({**request, "request_id": bad}, reply_type))
    assert reply["type"] == "error" and reply["code"] == "invalid_request" and reply["phase"] == phase
    assert "request_id" not in reply


def test_max_length_id_is_accepted():
    request, reply_type, _, _ = CASES["discovery_evaluators"]
    assert asyncio.run(ask({**request, "request_id": "a" * 64}, reply_type))["request_id"] == "a" * 64


def test_helpers():
    assert valid_request_id({"request_id": "ok-1"}) == "ok-1"
    assert valid_request_id({"request_id": "no good"}) is None and valid_request_id({}) is None
    assert request_id_problem({}) is None and request_id_problem({"request_id": None}) is None
    assert request_id_problem({"request_id": "bad id"})
    original = {"type": "x"}
    assert with_request_id(original, {"request_id": "r"}) == {"type": "x", "request_id": "r"}
    assert original == {"type": "x"}, "payload must not be mutated"
