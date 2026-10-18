"""Seed programs pass every guardrail through the real wire -> sandbox -> scorer path."""

from __future__ import annotations

import asyncio
import os
import re

import pytest

pytest.importorskip("qiskit")
pytest.importorskip("stim")
pytest.importorskip("pymatching")

from kernel import server  # noqa: E402
from kernel.discovery import isolation  # noqa: E402
from kernel.discovery import manager as manager_module  # noqa: E402
from kernel.discovery.manager import DiscoveryManager  # noqa: E402
from kernel.tests.test_discovery_handlers import StreamingWS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEEDS = os.path.join(ROOT, "kernel", "discovery", "seeds")
TEMPLATES = os.path.join(ROOT, "src", "services", "discovery", "templates.ts")

CASES = {
    "w_state": ("state_synthesis", {"target": {"kind": "w", "n_qubits": 5}}, 5,
                ["ir_conversion", "gate_set", "qubit_count", "no_measurement", "parameter_budget"]),
    "tfim_ansatz": ("vqe_ground_state", {"hamiltonian": {"kind": "tfim", "n_qubits": 6, "h": 1.0}}, 6,
                    ["ir_conversion", "qubit_count", "parameter_budget", "has_parameters",
                     "trainability_prefilter", "variational_bound"]),
}


def read_seed(name: str) -> str:
    with open(os.path.join(SEEDS, f"{name}.py"), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def _manager(tmp_path, monkeypatch):
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    isolation.reset_for_tests()
    manager_module.set_manager(DiscoveryManager(max_workers=2, cache_dir=str(tmp_path / "cache")))
    yield
    manager_module.set_manager(None)
    isolation.reset_for_tests()


async def evaluate(name: str, stage: str = "full", seed: int = 7) -> dict:
    kind, config, _, _ = CASES[name]
    ws = StreamingWS()
    connection = asyncio.create_task(server.handle_message(ws))
    try:
        ws.push({
            "type": "discovery_evaluate", "run_id": "r-1", "candidate_id": "c-1",
            "evaluator": {"kind": kind, "config": config}, "program": read_seed(name), "seed": seed,
            "stage": stage,
        })
        message = (await ws.wait_for(lambda m: m.get("type") == "discovery_evaluation", 120.0))[0]
    finally:
        ws.close()
        await connection
    return message["evaluation"]


@pytest.mark.parametrize("name", list(CASES))
def test_seed_structure(name):
    text = read_seed(name)
    assert text.count("# EVOLVE-BLOCK-START") == 1 and text.count("# EVOLVE-BLOCK-END") == 1
    assert text.index("# EVOLVE-BLOCK-START") < text.index("# EVOLVE-BLOCK-END")
    assert re.search(r"^def build\(n_qubits: int\)", text, re.M)


@pytest.mark.asyncio
async def test_w_state_seed_passes_every_guardrail_and_prepares_w():
    ev = await evaluate("w_state")
    assert ev["status"] == "scored", ev
    assert [g["id"] for g in ev["guardrails"]] == CASES["w_state"][3]
    assert all(g["status"] == "pass" for g in ev["guardrails"])
    assert ev["metrics"]["fidelity"] == pytest.approx(1.0, abs=1e-9)
    assert ev["descriptors"] == {"two_qubit_gates": 12, "depth": 17}  # 3 (n - 1) two-qubit gates
    assert ev["fitness"] == pytest.approx(10 - 0.1 * 12)
    assert ev["evaluator"]["kind"] == "state_synthesis" and ev["compute"]["method"] == "statevector_exact"
    assert ev["failure"] is None and ev["rejection"] is None


@pytest.mark.asyncio
async def test_tfim_seed_passes_every_guardrail_and_trains():
    ev = await evaluate("tfim_ansatz")
    assert ev["status"] == "scored", ev
    assert [g["id"] for g in ev["guardrails"]] == CASES["tfim_ansatz"][3]
    assert all(g["status"] == "pass" for g in ev["guardrails"])
    metrics = ev["metrics"]
    assert metrics["e_best"] >= metrics["e0"] - 1e-8
    assert metrics["relative_energy_error"] < 0.05
    assert ev["descriptors"] == {"parameters": 18, "two_qubit_gates": 10}
    assert len(metrics["curve"]) <= 50
    assert metrics["prefilter"]["variance_mean"] > 1e-5
    # Candidate-line gradient map: the RY loops sit on lines 19 and 24 of the seed text.
    lines = {entry["line"]: entry for entry in metrics["gradient_map"]["lines"]}
    seed_lines = read_seed("tfim_ansatz").splitlines()
    assert all("qc.ry" in seed_lines[number - 1] for number in lines)
    assert not any(entry["dead"] for entry in lines.values())


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CASES))
async def test_screen_stage_also_scores_the_seeds(name):
    ev = await evaluate(name, stage="screen")
    assert ev["status"] == "scored" and ev["stage"] == "screen"


@pytest.mark.asyncio
async def test_seed_is_deterministic_for_a_seed_and_cache_keyed_by_it():
    first = await evaluate("tfim_ansatz", stage="screen", seed=3)
    manager_module.get_manager().cache = type(manager_module.get_manager().cache)()  # fresh cache
    again = await evaluate("tfim_ansatz", stage="screen", seed=3)
    assert again["cache_hit"] is False
    assert again["metrics"] == first["metrics"] and again["fitness"] == first["fitness"]


@pytest.mark.asyncio
async def test_seed_runs_under_default_isolation(monkeypatch):
    monkeypatch.delenv("NUCLEI_DISCOVERY_ISOLATION", raising=False)
    isolation.reset_for_tests()
    ev = await evaluate("w_state", stage="screen")
    assert ev["status"] == "scored", ev
    assert ev["isolation"] in ("process", "sandbox-exec", "bwrap")


@pytest.mark.parametrize("name,const", [("w_state", "W_STATE_SEED"), ("tfim_ansatz", "TFIM_SEED")])
def test_frontend_template_seed_text_matches_the_kernel_seed(name, const):
    if not os.path.exists(TEMPLATES):
        pytest.skip("frontend templates not present")
    with open(TEMPLATES, encoding="utf-8") as handle:
        match = re.search(rf"const {const} = `(.*?)`;", handle.read(), re.S)
    assert match, f"{const} not found in templates.ts"
    assert match.group(1) == read_seed(name)
