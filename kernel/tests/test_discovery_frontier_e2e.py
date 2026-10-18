"""trainability_frontier end to end: wire -> sandbox -> scorer, the seed, drift and the audit."""

from __future__ import annotations

import asyncio
import os
import re
import time

import pytest

pytest.importorskip("qiskit")

from kernel import server  # noqa: E402
from kernel.discovery import isolation  # noqa: E402
from kernel.discovery import manager as manager_module  # noqa: E402
from kernel.discovery.audits import trainability_frontier as frontier_audit  # noqa: E402
from kernel.discovery.evaluators import EVALUATORS, effective_config, normalize_config  # noqa: E402
from kernel.discovery.manager import DiscoveryManager  # noqa: E402
from kernel.tests.test_discovery_frontier import artifact  # noqa: E402
from kernel.tests.test_discovery_handlers import StreamingWS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEED_PATH = os.path.join(ROOT, "kernel", "discovery", "seeds", "trainability_frontier.py")
TEMPLATES = os.path.join(ROOT, "src", "services", "discovery", "templates.ts")
GUARDRAILS = ["ir_conversion", "ppe_class", "qubit_count", "parameter_budget", "nontrivial_variance",
              "nontrivial_algebra", "exactness"]
SPEC = EVALUATORS["trainability_frontier"]


def read_seed() -> str:
    with open(SEED_PATH, encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def _manager(tmp_path, monkeypatch):
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    isolation.reset_for_tests()
    manager_module.set_manager(DiscoveryManager(max_workers=2, cache_dir=str(tmp_path / "cache")))
    yield
    manager_module.set_manager(None)
    isolation.reset_for_tests()


async def evaluate(program: str, config: dict | None = None, stage: str = "full", seed: int = 7) -> dict:
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    try:
        ws.push({
            "type": "discovery_evaluate", "run_id": "r-1", "candidate_id": "c-1",
            "evaluator": {"kind": "trainability_frontier", "config": config or {}},
            "program": program, "seed": seed, "stage": stage,
        })
        message = (await ws.wait_for(lambda m: m.get("type") == "discovery_evaluation", 300.0))[0]
    finally:
        ws.close()
        await connection
    return message["evaluation"]


def test_seed_structure_and_template_drift():
    text = read_seed()
    assert text.count("# EVOLVE-BLOCK-START") == 1 and text.count("# EVOLVE-BLOCK-END") == 1
    assert text.index("# EVOLVE-BLOCK-START") < text.index("# EVOLVE-BLOCK-END")
    assert re.search(r"^def build\(n_qubits: int, n_layers: int\)", text, re.M)
    if not os.path.exists(TEMPLATES):
        pytest.skip("frontend templates not present")
    with open(TEMPLATES, encoding="utf-8") as handle:
        match = re.search(r"const FRONTIER_SEED = `(.*?)`;", handle.read(), re.S)
    assert match, "FRONTIER_SEED not found in templates.ts"
    assert match.group(1) == text


@pytest.mark.slow  # ~5 s idle, 15-40 s on a loaded machine
@pytest.mark.asyncio
async def test_seed_passes_every_guardrail_at_the_default_config():
    started = time.monotonic()
    ev = await evaluate(read_seed())
    elapsed = time.monotonic() - started
    assert ev["status"] == "scored", ev
    assert [g["id"] for g in ev["guardrails"]] == GUARDRAILS
    assert all(g["status"] == "pass" for g in ev["guardrails"])
    assert elapsed < 120
    assert ev["evaluator"]["kind"] == "trainability_frontier" and ev["compute"]["method"] == "pauli_propagation_exact"
    assert set(ev["descriptors"]) == {"log2_dla_dimension", "two_qubit_gates_per_layer"}
    m = ev["metrics"]
    assert [p["n_qubits"] for p in m["variance_points"]] == [8, 16, 32, 64]
    assert m["dla"]["dimension"] == 255 and m["hardness"]["censored"] is False
    assert m["hardness"]["frontier_needed_lower"] == 10_000
    assert ev["fitness"] == pytest.approx(
        m["terms"]["trainability"] + m["terms"]["hardness"] + m["terms"]["inexact_penalty"])
    assert ev["fitness"] > 0 and ev["objectives"]["beta"]["ci95"][1] < 0.5
    # Candidate-line gradient map: the RY / RZ loops of the seed (recovered by trace_gate_lines).
    seed_lines = read_seed().splitlines()
    lines = {e["line"]: e for e in m["gradient_map"]["lines"]}
    assert len(lines) == 2 and not any(e["dead"] for e in lines.values())
    assert {("qc.ry" in seed_lines[n - 1], "qc.rz" in seed_lines[n - 1]) for n in lines} == {(True, False), (False, True)}
    assert m["gradient_map"]["method"] == "pauli_propagation_exact"


@pytest.mark.asyncio
async def test_screen_stage_scores_the_seed():
    ev = await evaluate(read_seed(), stage="screen")
    assert ev["status"] == "scored" and ev["stage"] == "screen"
    assert ev["metrics"]["settings"]["sizes"] == [8, 16]


@pytest.mark.asyncio
async def test_cheating_program_is_rejected_through_the_real_path():
    program = read_seed().replace("qc.rz(theta[k], q)", "qc.t(q)\n            qc.rz(theta[k], q)")
    ev = await evaluate(program, {"qubits": [4, 6], "n_layers": 2})
    assert ev["status"] == "rejected" and ev["rejection"]["guardrail"] == "ppe_class"
    assert ev["fitness"] is None


@pytest.mark.slow
@pytest.mark.asyncio
async def test_deterministic_per_seed_and_cache_keyed_by_it():
    config = {"qubits": [4, 6, 8, 10], "n_layers": 3}
    first = await evaluate(read_seed(), config, seed=3)
    manager_module.get_manager().cache = type(manager_module.get_manager().cache)()
    again = await evaluate(read_seed(), config, seed=3)
    assert again["cache_hit"] is False
    assert again["metrics"] == first["metrics"] and again["fitness"] == first["fitness"]


@pytest.mark.slow
def test_audit_agrees_on_the_seed_at_the_default_config():
    namespace: dict = {}
    exec(compile(read_seed(), SEED_PATH, "exec"), namespace)
    cfg = effective_config(SPEC, normalize_config(SPEC, {}), "full")
    arts = [{"call_index": i, "artifact": artifact(namespace["build"](*c["args"]))} for i, c in enumerate(SPEC.calls(cfg))]
    evaluation = SPEC.score(cfg, arts, 7, None, None, stage="full").to_dict()
    assert evaluation["status"] == "scored"
    report = frontier_audit.audit(cfg, arts, 7, evaluation=evaluation)
    assert [c["status"] for c in report["checks"]] == ["pass"] * 7, report["checks"]
    assert report["audit_fitness"] == pytest.approx(evaluation["fitness"], abs=0.6)
