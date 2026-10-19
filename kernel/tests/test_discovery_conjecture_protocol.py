"""Conjecture protocol tests (StreamingWS): ordering, cancel, owner release, busy, schema, errors."""

from __future__ import annotations

import asyncio
import textwrap

import pytest

from kernel.discovery.conjecture import jobs, worker
from kernel.discovery.conjecture.jobs import ConjectureJobManager
from kernel.tests._trainability_job_helpers import connection, wait_gone

FAKE_MODULE = "fake_conjecture_tester"
FAKE_SOURCE = textwrap.dedent('''
    import time

    def test_conjecture(conjecture, *, seed, progress, cancel, on_evidence):
        mode = conjecture["id"]
        for i in range(200):
            progress(i / 200, "working", 0)
        if mode == "hang":
            on_evidence({"circuit_index": 0, "variant_id": "v0", "outcome": "meets"})
            time.sleep(600)
        if mode == "boom":
            raise RuntimeError("boom in tester")
        for i in range(3):
            on_evidence({"circuit_index": i, "variant_id": f"v{i}", "outcome": "meets"})
        return {"conjecture_id": mode, "verdict": "supported", "seed": seed, "evidence": []}
''')
CLAIM = {
    "id": "ok", "statement": "protocol test", "feature_predicate": None,
    "prediction": {"quantity": "beta_upper95", "op": "<", "value": 0.2},
    "test_family": {"rotation_axes": ["Y", "Z"], "layers": [1, 2], "rotations_per_qubit_per_layer": 2},
    "n_range": [4, 8], "circuits": 5, "points": 4,
}


@pytest.fixture
def make_manager(tmp_path):
    (tmp_path / f"{FAKE_MODULE}.py").write_text(FAKE_SOURCE, encoding="utf-8")
    created: list[ConjectureJobManager] = []
    previous = jobs.get_manager()

    def factory(fake: bool = True, **kwargs) -> ConjectureJobManager:
        manager = ConjectureJobManager(
            extra_env={worker.OVERRIDE_ENV: FAKE_MODULE} if fake else {},
            extra_sys_path=[str(tmp_path)] if fake else [], **kwargs)
        created.append(manager)
        jobs.set_manager(manager)
        return manager

    yield factory
    for manager in created:
        manager.release_all()
    jobs.set_manager(previous)


def start(job_id: str, claim_id: str = "ok", **extra) -> dict:
    return {"type": "discovery_conjecture_test", "job_id": job_id, "conjecture": {**CLAIM, "id": claim_id},
            "seed": 5, **extra}


def run(scenario):
    return asyncio.run(scenario())


def test_message_order_and_payloads(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start("j1"))
            await ws.wait_type("discovery_conjecture_result")
            return list(ws.sent)

    sent = run(scenario)
    types = [m["type"] for m in sent]
    assert types[0] == "discovery_conjecture_started" and types[-1] == "discovery_conjecture_result"
    assert all(m["job_id"] == "j1" for m in sent)
    evidence = [m for m in sent if m["type"] == "discovery_conjecture_evidence"]
    assert [m["item"]["circuit_index"] for m in evidence] == [0, 1, 2]
    progress = [m for m in sent if m["type"] == "discovery_conjecture_progress"]
    assert 1 <= len(progress) <= 20  # 200 emissions are throttled to <= 10 per second
    assert set(progress[0]) == {"type", "job_id", "fraction", "message", "circuit_index"}
    first_evidence = types.index("discovery_conjecture_evidence")
    assert types.index("discovery_conjecture_started") < first_evidence < len(types) - 1
    assert sent[-1]["status"] == "complete" and sent[-1]["result"]["verdict"] == "supported"
    assert sent[-1]["result"]["seed"] == 5


def test_real_tester_end_to_end(make_manager):
    make_manager(fake=False)

    async def scenario():
        async with connection() as ws:
            ws.push(start("real"))
            await ws.wait_type("discovery_conjecture_result", timeout=240)
            return list(ws.sent)

    sent = run(scenario)
    result = sent[-1]
    assert result["status"] == "complete" and result["result"]["verdict"] in ("supported", "refuted", "inconclusive")
    assert len([m for m in sent if m["type"] == "discovery_conjecture_evidence"]) == 5
    assert result["result"]["n_circuits_tested"] == 5


def test_cancel_kills_the_subprocess_and_reports_partial_evidence(make_manager):
    manager = make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start("hang", "hang"))
            await ws.wait_type("discovery_conjecture_evidence")
            pids = manager.pids()
            assert len(pids) == 1
            ws.push({"type": "discovery_conjecture_cancel", "job_id": "hang"})
            reply = await ws.wait_type("discovery_conjecture_cancelled")
            result = await ws.wait_type("discovery_conjecture_result")
            ws.push({"type": "discovery_conjecture_cancel", "job_id": "hang"})
            return pids, reply, result, ws

    pids, reply, result, ws = run(scenario)
    assert reply["accepted"] is True and result["status"] == "cancelled"
    assert result["result"]["verdict"] == "inconclusive" and result["result"]["partial"] is True
    assert result["result"]["n_circuits_tested"] == 1
    assert wait_gone(pids)
    assert [m["accepted"] for m in ws.sent if m["type"] == "discovery_conjecture_cancelled"][-1] is False


def test_closing_the_connection_releases_the_owner_and_kills_jobs(make_manager):
    manager = make_manager()
    captured: list[int] = []

    async def scenario():
        async with connection() as ws:
            ws.push(start("a", "hang"))
            ws.push(start("b", "hang"))
            await ws.wait_for(lambda m: m.get("type") == "discovery_conjecture_started" and m["job_id"] == "b")
            captured.extend(manager.pids())

    run(scenario)
    assert len(captured) == 2 and wait_gone(captured)


def test_busy_per_owner_and_global(make_manager):
    manager = make_manager(max_per_owner=2, max_global=3)

    async def scenario():
        async with connection() as one, connection() as two:
            for name in ("a", "b", "c"):
                one.push(start(name, "hang"))
            err = await one.wait_for(lambda m: m.get("type") == "error")
            two.push(start("d", "hang"))
            await two.wait_for(lambda m: m.get("type") == "discovery_conjecture_started")
            two.push(start("e", "hang"))
            err2 = await two.wait_for(lambda m: m.get("type") == "error")
            return err[0], err2[0], manager.running()

    first, second, running = run(scenario)
    assert first["code"] == "conjecture_busy" and first["phase"] == "discovery" and first["job_id"] == "c"
    assert second["code"] == "conjecture_busy" and running == 3


def test_duplicate_job_id_is_rejected(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(start("dup", "hang"))
            ws.push(start("dup", "hang"))
            return (await ws.wait_for(lambda m: m.get("type") == "error"))[0]

    assert run(scenario)["code"] == "invalid_request"


def test_wall_limit_and_worker_crash_report_failed(make_manager):
    make_manager(wall_limit_s=1.5)

    async def scenario():
        async with connection() as ws:
            ws.push(start("slow", "hang"))
            slow = await ws.wait_type("discovery_conjecture_result", timeout=60)
            ws.push(start("crash", "boom"))
            crash = await ws.wait_for(lambda m: m.get("type") == "discovery_conjecture_result"
                                      and m["job_id"] == "crash", timeout=60)
            return slow, crash[0]

    slow, crash = run(scenario)
    assert slow["status"] == "failed" and slow["error"]["code"] == "wall_limit"
    assert crash["status"] == "failed" and crash["error"]["code"] == "conjecture_internal"
    assert "boom in tester" in crash["error"]["message"]


def test_invalid_conjecture_error_carries_the_path(make_manager):
    make_manager()
    bad = {**CLAIM, "feature_predicate": {"all": [{"feature": "__class__", "op": "==", "value": 1}]}}

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "discovery_conjecture_test", "job_id": "x", "conjecture": bad})
            ws.push({"type": "discovery_conjecture_test", "job_id": "", "conjecture": CLAIM})
            return await ws.wait_for(lambda m: m.get("type") == "error")

    errors = run(scenario)
    assert errors[0]["code"] == "invalid_conjecture" and errors[0]["phase"] == "discovery"
    assert errors[0]["path"] == "feature_predicate.all[0].feature" and errors[0]["job_id"] == "x"


def test_schema_message(make_manager):
    make_manager()

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "discovery_conjecture_schema"})
            return await ws.wait_type("discovery_conjecture_schema_result")

    reply = run(scenario)
    keys = {f["key"] for f in reply["features"]}
    assert {"n_layers", "entangler_pattern", "rotation_axis_counts.Y"} <= keys
    assert all({"key", "type", "description"} <= set(f) for f in reply["features"])
    assert {q["name"] for q in reply["quantities"]} == {
        "beta_upper95", "verdict", "variance_at_max_n", "log2_dla_dimension"}
    assert reply["families"]["properties"]["pattern"]["enum"] == ["brick", "ladder", "ring", "all_to_all"]
    assert reply["predicate"]["$defs"]["leaf"]["required"] == ["feature", "op", "value"]
    assert reply["limits"]["n_max"] == 128
