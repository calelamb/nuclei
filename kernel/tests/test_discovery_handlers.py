"""Handler tests (StreamingWS pattern from test_qec_campaign.py) for protocol v1.3 discovery."""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time

import pytest

pytest.importorskip("stim")
pytest.importorskip("pymatching")

from kernel import server  # noqa: E402
from kernel.discovery import manager as manager_module  # noqa: E402
from kernel.discovery.manager import DiscoveryManager  # noqa: E402
from kernel.lab_context import release_owner  # noqa: E402

SEED_PATH = "kernel/discovery/seeds/qec_repetition.py"
FAST = {"shots": {"min": 1000, "max": 6000, "max_errors": 50}}
CANCELLED_REPLY = {
    "status": "error", "artifacts": [], "stdout": "", "stderr": "",
    "error": {"code": "cancelled", "message": "x"}, "isolation": "process",
}


class StreamingWS:
    """Drives server.handle_message like a live connection."""

    def __init__(self) -> None:
        self._incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []
        self._activity = asyncio.Event()

    def push(self, message: dict) -> None:
        self._incoming.put_nowait(json.dumps(message))

    def close(self) -> None:
        self._incoming.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._incoming.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))
        self._activity.set()

    def count(self, kind: str) -> int:
        return len([m for m in self.sent if m.get("type") == kind])

    async def wait_for(self, predicate, timeout: float = 90.0):
        deadline = time.monotonic() + timeout
        while True:
            match = [m for m in self.sent if predicate(m)]
            if match:
                return match
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"no match in {timeout}s; got {[m.get('type') for m in self.sent]}")
            self._activity.clear()
            try:
                await asyncio.wait_for(self._activity.wait(), timeout=min(remaining, 0.5))
            except asyncio.TimeoutError:
                pass


def blocking_sandbox(seen: list | None = None):
    def run(request, *, wall_seconds, cancel_event=None):
        if seen is not None:
            seen.append(cancel_event)
        cancel_event.wait(30)
        return dict(CANCELLED_REPLY)

    return run


@pytest.fixture(autouse=True)
def _isolated_manager(tmp_path, monkeypatch):
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    from kernel.discovery import isolation

    isolation.reset_for_tests()
    manager = DiscoveryManager(max_workers=2, cache_dir=str(tmp_path / "cache"))
    manager_module.set_manager(manager)
    yield manager
    manager_module.set_manager(None)
    isolation.reset_for_tests()


@pytest.fixture(scope="module")
def seed_program() -> str:
    with open(SEED_PATH, encoding="utf-8") as handle:
        return handle.read()


def is_type(kind: str, **fields):
    return lambda m: m.get("type") == kind and all(m.get(k) == v for k, v in fields.items())


def evaluate_msg(program: str, candidate_id="c-1", run_id="r-1", config=None, **extra) -> dict:
    return {
        "type": "discovery_evaluate", "run_id": run_id, "candidate_id": candidate_id,
        "evaluator": {"kind": "qec_memory", "config": config if config is not None else FAST},
        "program": program, "seed": 11, **extra,
    }


async def session(messages, wait, timeout=90.0):
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    try:
        for message in messages:
            ws.push(message)
        for predicate in wait:
            await ws.wait_for(predicate, timeout)
    finally:
        ws.close()
        await connection
    return ws


def evaluations(ws: StreamingWS) -> dict[str, dict]:
    return {m["candidate_id"]: m["evaluation"] for m in ws.sent if m["type"] == "discovery_evaluation"}


@pytest.mark.asyncio
async def test_evaluators_list_shape():
    ws = await session([{"type": "discovery_evaluators"}], [is_type("discovery_evaluators_result")])
    result = [m for m in ws.sent if m["type"] == "discovery_evaluators_result"][0]
    (spec,) = [e for e in result["evaluators"] if e["kind"] == "qec_memory"]
    for key in ("kind", "version", "title", "description", "task", "entry_signature", "objectives",
                "descriptors", "config_schema", "default_config"):
        assert key in spec
    assert spec["task"] == "stim_circuit" and spec["default_config"]["distances"] == [3, 5]


@pytest.mark.asyncio
async def test_evaluate_end_to_end_record_and_cache_hit(seed_program):
    ws = await session(
        [evaluate_msg(seed_program)],
        [is_type("discovery_evaluate_accepted"), is_type("discovery_evaluation")],
    )
    accepted = [m for m in ws.sent if m["type"] == "discovery_evaluate_accepted"][0]
    assert accepted["run_id"] == "r-1" and accepted["candidate_id"] == "c-1"
    assert isinstance(accepted["queue_position"], int) and accepted["queue_position"] >= 0
    order = [m["type"] for m in ws.sent]
    assert order.index("discovery_evaluate_accepted") < order.index("discovery_evaluation")
    message = [m for m in ws.sent if m["type"] == "discovery_evaluation"][0]
    assert message["run_id"] == "r-1" and message["candidate_id"] == "c-1"
    ev = message["evaluation"]
    assert ev["status"] == "scored" and ev["fitness"] > 0
    assert ev["candidate_id"] == "c-1" and ev["run_id"] == "r-1"
    assert ev["stage"] == "full" and ev["seed"] == 11 and ev["cache_hit"] is False
    assert re.fullmatch(r"[0-9a-f]{64}", ev["program_key"])
    assert re.fullmatch(r"[0-9a-f]{64}", ev["evaluator"]["fingerprint"])
    assert ev["evaluator"]["kind"] == "qec_memory" and ev["evaluator"]["version"] == "1.0.0"
    assert ev["isolation"] == "process"
    assert ev["compute"] == {"backend": "numpy", "method": "stim_pymatching_sampling"}
    assert set(ev["timings_ms"]) == {"sandbox", "score", "total"} and ev["timings_ms"]["sandbox"] > 0
    assert [g["status"] for g in ev["guardrails"]] == ["pass"] * 10
    assert ev["rejection"] is None and ev["failure"] is None
    assert ev["objectives"]["logical_error_per_round"]["direction"] == "minimize"
    assert set(ev["metrics"]) == {"per_distance", "lambda", "distance_verified", "distance_penalty"}

    # A comment-only edit shares the program_key, so the second evaluation is a cache hit.
    ws2 = await session(
        [evaluate_msg("# a harmless comment\n" + seed_program, candidate_id="c-2")],
        [is_type("discovery_evaluation")],
    )
    second = evaluations(ws2)["c-2"]
    assert second["cache_hit"] is True
    assert second["program_key"] == ev["program_key"]
    assert second["fitness"] == ev["fitness"] and second["metrics"] == ev["metrics"]
    assert second["timings_ms"]["sandbox"] == 0 and second["timings_ms"]["total"] < ev["timings_ms"]["total"]


@pytest.mark.asyncio
async def test_stage_changes_budget_and_is_a_separate_cache_entry(seed_program):
    ws = await session(
        [evaluate_msg(seed_program, candidate_id="s", stage="screen"),
         evaluate_msg(seed_program, candidate_id="f", stage="full")],
        [is_type("discovery_evaluation", candidate_id="s"), is_type("discovery_evaluation", candidate_id="f")],
    )
    by_id = evaluations(ws)
    assert by_id["s"]["stage"] == "screen" and by_id["f"]["stage"] == "full"
    assert by_id["s"]["cache_hit"] is False and by_id["f"]["cache_hit"] is False
    assert [g for g in by_id["s"]["guardrails"] if g["id"] == "fault_distance"][0]["status"] == "skipped"
    assert [g for g in by_id["f"]["guardrails"] if g["id"] == "fault_distance"][0]["status"] == "pass"


@pytest.mark.asyncio
async def test_rejected_candidate_reports_guardrail(seed_program):
    cheat = seed_program.replace(
        'circuit.append("M", data)', 'circuit.append("DEPOLARIZE1", data, 0.01)\n    circuit.append("M", data)'
    )
    assert cheat != seed_program
    ws = await session([evaluate_msg(cheat)], [is_type("discovery_evaluation")])
    ev = evaluations(ws)["c-1"]
    assert ev["status"] == "rejected" and ev["fitness"] is None
    assert ev["rejection"]["guardrail"] == "noiseless"
    assert [g["status"] for g in ev["guardrails"]][:3] == ["pass", "fail", "skipped"]


@pytest.mark.asyncio
async def test_sandbox_failures_are_failed_evaluations_with_stage_and_code():
    cases = {
        "compile_error": "def build(:\n",
        "entry_raised": "def build(d, r):\n    raise ValueError('nope')\n",
        "entry_missing": "x = 1\n",
        "bad_return_type": "def build(d, r):\n    return 5\n",
    }
    ws = await session(
        [evaluate_msg(program, candidate_id=code) for code, program in cases.items()],
        [is_type("discovery_evaluation", candidate_id=c) for c in cases],
    )
    for code, ev in evaluations(ws).items():
        assert ev["status"] == "failed" and ev["fitness"] is None
        assert ev["failure"]["stage"] == "sandbox" and ev["failure"]["code"] == code
        assert ev["timings_ms"]["score"] == 0


@pytest.mark.asyncio
async def test_error_envelopes():
    base = evaluate_msg("x = 1\n")
    bad_config = {**base, "evaluator": {"kind": "qec_memory", "config": {"distances": [1]}}}
    unknown = {**base, "evaluator": {"kind": "nope", "config": {}}}
    no_seed = {k: v for k, v in base.items() if k != "seed"}
    bad_stage = {**base, "stage": "weird"}
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    for message in (bad_config, unknown, no_seed, bad_stage):
        ws.push(message)
    await ws.wait_for(lambda m: ws.count("error") == 4)
    ws.close()
    await connection
    errors = [m for m in ws.sent if m["type"] == "error"]
    assert [e["code"] for e in errors] == ["invalid_config", "unknown_evaluator", "invalid_request", "invalid_request"]
    for e in errors:
        assert e["phase"] == "discovery" and e["run_id"] == "r-1" and e["candidate_id"] == "c-1" and e["message"]
    assert ws.count("discovery_evaluate_accepted") == 0


@pytest.mark.asyncio
async def test_cancel_running_evaluation_emits_failed_cancelled():
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    try:
        ws.push(evaluate_msg("import time\ntime.sleep(120)\n", candidate_id="slow"))
        await ws.wait_for(is_type("discovery_evaluate_accepted"))
        await asyncio.sleep(1.0)  # let the sandbox process start
        started = time.monotonic()
        ws.push({"type": "discovery_cancel", "run_id": "r-1", "candidate_id": "slow"})
        await ws.wait_for(is_type("discovery_cancelled"))
        await ws.wait_for(is_type("discovery_evaluation"))
        assert time.monotonic() - started < 90
    finally:
        ws.close()
        await connection
    cancelled = [m for m in ws.sent if m["type"] == "discovery_cancelled"][0]
    assert cancelled == {"type": "discovery_cancelled", "run_id": "r-1", "candidate_id": "slow", "cancelled": 1}
    ev = evaluations(ws)["slow"]
    assert ev["status"] == "failed" and ev["failure"]["code"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_whole_run_counts_all_candidates_of_that_run_only():
    manager_module.set_manager(DiscoveryManager(max_workers=1, sandbox_runner=blocking_sandbox()))
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    try:
        for i in range(3):
            ws.push(evaluate_msg("x = 1\n", candidate_id=f"c{i}"))
        ws.push(evaluate_msg("x = 1\n", candidate_id="other", run_id="r-2"))
        await ws.wait_for(lambda m: ws.count("discovery_evaluate_accepted") == 4)
        ws.push({"type": "discovery_cancel", "run_id": "r-1"})
        await ws.wait_for(is_type("discovery_cancelled"))
        await ws.wait_for(lambda m: ws.count("discovery_evaluation") == 3)
    finally:
        ws.close()
        await connection
        release_owner(id(ws))
    assert [m for m in ws.sent if m["type"] == "discovery_cancelled"][0]["cancelled"] == 3
    assert set(evaluations(ws)) == {"c0", "c1", "c2"}
    assert all(e["failure"]["code"] == "cancelled" for e in evaluations(ws).values())


@pytest.mark.asyncio
async def test_owner_release_cancels_everything_it_holds():
    seen: list[threading.Event] = []
    manager = DiscoveryManager(max_workers=2, sandbox_runner=blocking_sandbox(seen))
    manager_module.set_manager(manager)
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    for i in range(3):
        ws.push(evaluate_msg("x = 1\n", candidate_id=f"c{i}"))
    await ws.wait_for(lambda m: ws.count("discovery_evaluate_accepted") == 3)
    assert manager.pending_count(id(ws)) == 3
    ws.close()
    await connection
    release_owner(id(ws))  # server._handle_connection does this when the socket closes
    deadline = time.monotonic() + 60
    while manager.pending_count(id(ws)) and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    assert manager.pending_count(id(ws)) == 0
    assert seen and all(event.is_set() for event in seen)


@pytest.mark.asyncio
async def test_queue_cap_returns_discovery_busy():
    manager_module.set_manager(DiscoveryManager(max_workers=1, sandbox_runner=blocking_sandbox()))
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    try:
        for i in range(65):
            ws.push(evaluate_msg("x = 1\n", candidate_id=f"c{i}"))
        await ws.wait_for(lambda m: m.get("type") == "error" and m.get("code") == "discovery_busy")
    finally:
        ws.close()
        await connection
        release_owner(id(ws))
    accepted = [m for m in ws.sent if m["type"] == "discovery_evaluate_accepted"]
    assert len(accepted) == 64
    busy = [m for m in ws.sent if m["type"] == "error"][0]
    assert busy["phase"] == "discovery" and busy["candidate_id"] == "c64"
    assert all(m["queue_position"] >= 0 for m in accepted)
    assert accepted[-1]["queue_position"] >= accepted[1]["queue_position"]


@pytest.mark.asyncio
async def test_mutate_handler(seed_program):
    ws = await _mutate_session(seed_program)
    result = [m for m in ws.sent if m["type"] == "discovery_mutations"][0]
    assert 1 <= len(result["mutations"]) <= 5
    assert all(set(m) == {"program", "operators", "description"} for m in result["mutations"])
    codes = [m["code"] for m in ws.sent if m["type"] == "error"]
    assert codes == ["mutation_failed", "invalid_request"]


async def _mutate_session(seed_program: str) -> StreamingWS:
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    ws.push({"type": "discovery_mutate", "program": seed_program, "seed": 4, "count": 5})
    ws.push({"type": "discovery_mutate", "program": "x = 1\n# EVOLVE-BLOCK-START\n", "seed": 4, "count": 2})
    ws.push({"type": "discovery_mutate", "program": seed_program, "seed": 4, "count": 0})
    await ws.wait_for(lambda m: ws.count("discovery_mutations") == 1 and ws.count("error") == 2)
    ws.close()
    await connection
    return ws


@pytest.mark.asyncio
async def test_surface_code_candidate_shows_lambda_above_one_end_to_end():
    program = (
        "import stim\n"
        "def build(distance, rounds):\n"
        "    return stim.Circuit.generated('surface_code:rotated_memory_z', distance=distance, rounds=rounds)\n"
    )
    config = {"noise": {"model": "si1000", "p": 1e-3}}
    ws = await session([evaluate_msg(program, config=config)], [is_type("discovery_evaluation")], timeout=120)
    ev = evaluations(ws)["c-1"]
    assert ev["status"] == "scored", ev["rejection"] or ev["failure"]
    lam = ev["metrics"]["lambda"][0]
    assert lam["ci95"][0] > 1 and lam["verdict"] == "suppressing"
