"""Websocket protocol tests for Red Queen audits (discovery_audit / _cancel) over the StreamingWS pattern."""

from __future__ import annotations

import asyncio
import re
import threading
import time

import pytest

pytest.importorskip("stim")
pytest.importorskip("pymatching")
pytest.importorskip("qiskit")

from kernel import server  # noqa: E402
from kernel.discovery import manager as manager_module  # noqa: E402
from kernel.discovery.audits import runner as audit_runner  # noqa: E402
from kernel.discovery.audits.runner import AuditManager  # noqa: E402
from kernel.lab_context import owner_for_connection, release_owner  # noqa: E402
from kernel.tests._discovery_audit_helpers import HONEST_SEEDS, honest_evaluation, read_seed  # noqa: E402
from kernel.tests.test_discovery_handlers import StreamingWS, is_type  # noqa: E402
from kernel.tests._auth_harness import serve_authenticated  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    from kernel.discovery import isolation

    isolation.reset_for_tests()
    manager_module.set_manager(manager_module.DiscoveryManager(max_workers=1, cache_dir=str(tmp_path / "cache")))
    yield
    audit_runner.set_audit_manager(None)
    manager_module.set_manager(None)
    isolation.reset_for_tests()


def audit_msg(name="qec_repetition", candidate_id="c-1", run_id="r-1", **extra) -> dict:
    kind, filename, config = HONEST_SEEDS[name]
    return {
        "type": "discovery_audit", "run_id": run_id, "candidate_id": candidate_id,
        "evaluator": {"kind": kind, "config": config}, "program": read_seed(filename), "seed": 11,
        "evaluation": honest_evaluation(name), **extra,
    }


def canned(verdict="consistent"):
    def run(request, cancel_event, *, cache_dir=None):
        return {"verdict": verdict, "checks": [], "reasons": [], "evaluator_fitness": None, "audit_fitness": None, "gap": None}

    return run


def blocking(seen: list):
    def run(request, cancel_event, *, cache_dir=None):
        seen.append(cancel_event)
        cancel_event.wait(30)
        return {"verdict": "inconclusive", "checks": [], "reasons": ["cancelled"]}

    return run


async def drive(messages, waits, timeout=240.0):
    ws = StreamingWS()
    connection = asyncio.create_task(serve_authenticated(ws))
    try:
        for message in messages:
            ws.push(message)
        for predicate in waits:
            await ws.wait_for(predicate, timeout)
    finally:
        ws.close()
        await connection
        release_owner(owner_for_connection(ws))
    return ws


@pytest.mark.asyncio
async def test_accepted_then_result_in_order_with_the_documented_record():
    ws = await drive(
        [audit_msg()], [is_type("discovery_audit_accepted"), is_type("discovery_audit_result")],
    )
    order = [m["type"] for m in ws.sent]
    assert order.index("discovery_audit_accepted") < order.index("discovery_audit_result")
    accepted = [m for m in ws.sent if m["type"] == "discovery_audit_accepted"][0]
    assert accepted == {"type": "discovery_audit_accepted", "run_id": "r-1", "candidate_id": "c-1", "queue_position": 0}
    result = [m for m in ws.sent if m["type"] == "discovery_audit_result"][0]
    assert result["run_id"] == "r-1" and result["candidate_id"] == "c-1"
    audit = result["audit"]
    assert set(audit) >= {
        "verdict", "evaluator_fitness", "audit_fitness", "gap", "checks", "reasons", "evaluator", "audit_fingerprint",
        "seed", "isolation", "timings_ms", "notes",
    }
    assert audit["verdict"] == "consistent" and audit["seed"] == 11
    assert re.fullmatch(r"[0-9a-f]{64}", audit["audit_fingerprint"])
    assert all(set(c) == {"id", "label", "status", "detail"} for c in audit["checks"])


@pytest.mark.asyncio
async def test_cancel_acknowledges_and_the_job_still_answers():
    seen: list[threading.Event] = []
    audit_runner.set_audit_manager(AuditManager(max_workers=1, job_runner=blocking(seen)))
    ws = await drive(
        [audit_msg(), {"type": "discovery_audit_cancel", "run_id": "r-1", "candidate_id": "c-1"}],
        [is_type("discovery_audit_accepted"), is_type("discovery_audit_cancelled"), is_type("discovery_audit_result")],
    )
    cancelled = [m for m in ws.sent if m["type"] == "discovery_audit_cancelled"][0]
    assert cancelled == {"type": "discovery_audit_cancelled", "run_id": "r-1", "candidate_id": "c-1", "cancelled": 1}
    assert seen and seen[0].is_set()


@pytest.mark.asyncio
async def test_cancel_of_a_whole_run_only_counts_that_run():
    seen: list[threading.Event] = []
    audit_runner.set_audit_manager(AuditManager(max_workers=1, job_runner=blocking(seen)))
    messages = [audit_msg(candidate_id=f"c{i}") for i in range(3)] + [audit_msg(candidate_id="other", run_id="r-2")]
    ws = StreamingWS()
    connection = asyncio.create_task(serve_authenticated(ws))
    try:
        for message in messages:
            ws.push(message)
        await ws.wait_for(lambda m: ws.count("discovery_audit_accepted") == 4)
        ws.push({"type": "discovery_audit_cancel", "run_id": "r-1"})
        await ws.wait_for(is_type("discovery_audit_cancelled"))
        await ws.wait_for(lambda m: ws.count("discovery_audit_result") >= 3, 60)
    finally:
        for event in seen:
            event.set()
        ws.close()
        await connection
        release_owner(owner_for_connection(ws))
    cancelled = [m for m in ws.sent if m["type"] == "discovery_audit_cancelled"][0]
    assert cancelled["cancelled"] == 3 and cancelled["candidate_id"] is None


@pytest.mark.asyncio
async def test_owner_release_cancels_every_audit_it_holds():
    seen: list[threading.Event] = []
    manager = AuditManager(max_workers=2, job_runner=blocking(seen))
    audit_runner.set_audit_manager(manager)
    ws = StreamingWS()
    connection = asyncio.create_task(serve_authenticated(ws))
    for i in range(3):
        ws.push(audit_msg(candidate_id=f"c{i}"))
    await ws.wait_for(lambda m: ws.count("discovery_audit_accepted") == 3)
    assert manager.pending_count(owner_for_connection(ws)) == 3
    ws.close()
    await connection
    release_owner(owner_for_connection(ws))  # what server._handle_connection does when the socket closes
    deadline = time.monotonic() + 15
    while manager.pending_count(owner_for_connection(ws)) and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    assert manager.pending_count(owner_for_connection(ws)) == 0
    assert seen and all(event.is_set() for event in seen)


@pytest.mark.asyncio
async def test_queue_cap_returns_discovery_busy():
    seen: list[threading.Event] = []
    audit_runner.set_audit_manager(AuditManager(max_workers=1, job_runner=blocking(seen)))
    ws = StreamingWS()
    connection = asyncio.create_task(serve_authenticated(ws))
    try:
        for i in range(65):
            ws.push(audit_msg(candidate_id=f"c{i}"))
        await ws.wait_for(lambda m: m.get("type") == "error" and m.get("code") == "discovery_busy")
    finally:
        for event in seen:
            event.set()
        ws.close()
        await connection
        release_owner(owner_for_connection(ws))
    assert ws.count("discovery_audit_accepted") == 64


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda m: m.pop("run_id"), "invalid_request"),
        (lambda m: m.update(evaluator={"kind": "nope"}), "unknown_evaluator"),
        (lambda m: m.update(evaluator={"kind": "qec_memory", "config": {"distances": "x"}}), "invalid_config"),
        (lambda m: m.update(evaluator="qec_memory"), "invalid_request"),
        (lambda m: m.update(evaluation={"status": "pending"}), "invalid_request"),
        (lambda m: m.update(evaluation=None), "invalid_request"),
        (lambda m: m.update(program="   "), "invalid_request"),
        (lambda m: m.update(seed=-1), "invalid_request"),
        (lambda m: m.update(entry="not valid!"), "invalid_request"),
    ],
)
async def test_bad_requests_use_the_discovery_error_envelope(mutate, code):
    message = audit_msg()
    mutate(message)
    ws = await drive([message], [lambda m: m.get("type") == "error"], 30)
    error = [m for m in ws.sent if m["type"] == "error"][0]
    assert error["phase"] == "discovery" and error["code"] == code and isinstance(error["message"], str)
    assert ws.count("discovery_audit_accepted") == 0


@pytest.mark.asyncio
async def test_unknown_audit_message_and_unavailable_audit():
    ws = await drive([{"type": "discovery_audit_bogus"}], [lambda m: m.get("type") == "error"], 30)
    assert [m for m in ws.sent if m["type"] == "error"][0]["code"] == "invalid_request"


def test_unavailable_audit_is_reported(monkeypatch):
    from kernel.discovery.audits import handlers

    monkeypatch.setattr(handlers, "has_audit", lambda kind: False)
    with pytest.raises(handlers.RequestError) as caught:
        handlers.parse_audit(audit_msg())
    assert caught.value.code == "audit_unavailable"


@pytest.mark.asyncio
async def test_audit_messages_leave_plain_evaluations_working():
    audit_runner.set_audit_manager(AuditManager(max_workers=1, job_runner=canned()))
    ws = await drive(
        [audit_msg(), {"type": "discovery_evaluators"}],
        [is_type("discovery_audit_result"), is_type("discovery_evaluators_result")], 60,
    )
    assert ws.count("discovery_audit_result") == 1
