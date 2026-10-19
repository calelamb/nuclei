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
    "discovery_program_key": ({"type": "discovery_program_key", "program": GOOD_PROGRAM}, "discovery_program_key_result",
                              {"type": "discovery_program_key", "program": "def x(:"}, "discovery"),
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


# ------------------------------------------------------- CR-M1: discovery_program_key


def test_program_key_matches_the_cache_normalization():
    from kernel.discovery.cache import program_key

    base = "def build(d, r):\n    x = 1\n    return x\n"
    edited = "# note\ndef build(d,  r):\n\n    x   =  1  # trailing\n    return x\n\n"

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "discovery_program_key", "program": base, "request_id": "k1"})
            ws.push({"type": "discovery_program_key", "program": edited})
            ws.push({"type": "discovery_program_key", "program": base.replace("= 1", "= 2")})
            await ws.wait_for(lambda m: len([x for x in ws.sent if x["type"] == "discovery_program_key_result"]) == 3, 30)
            return [m for m in ws.sent if m["type"] == "discovery_program_key_result"]

    first, second, third = asyncio.run(scenario())
    assert first == {"type": "discovery_program_key_result", "program_key": program_key(base), "request_id": "k1"}
    assert "request_id" not in second and second["program_key"] == first["program_key"]
    assert third["program_key"] != first["program_key"]


def test_program_key_reports_a_syntax_error_with_the_request_id():
    reply = asyncio.run(ask({"type": "discovery_program_key", "program": "def build(:\n", "request_id": "bad-1"},
                            "discovery_program_key_result"))
    assert reply["type"] == "error" and reply["phase"] == "discovery" and reply["code"] == "invalid_program"
    assert reply["request_id"] == "bad-1" and "line 1" in reply["message"]


def test_program_key_validates_the_program_field():
    reply = asyncio.run(ask({"type": "discovery_program_key", "program": ""}, "discovery_program_key_result"))
    assert reply["type"] == "error" and reply["code"] == "invalid_request"
