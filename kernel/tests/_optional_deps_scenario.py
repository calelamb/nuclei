"""Subprocess driver for ``test_discovery_optional_deps``: PRD 14 entry points WITHOUT optional packages.

Run as ``python -m kernel.tests._optional_deps_scenario``. Blocks stim / pymatching / sinter /
pyarrow / duckdb / jsonschema, drives every Discovery and Trainability entry point through the
real websocket handler, and prints one JSON object (prefixed ``RESULT:``) on the last line.
"""

from __future__ import annotations

from kernel.tests._optional_blocker import install_blocker

install_blocker()  # before anything imports the kernel

import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402

from kernel.tests._trainability_job_helpers import QISKIT_CODE, connection  # noqa: E402

SEEDS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "discovery", "seeds")
QEC_CONFIG = {"distances": [3, 5], "shots": {"min": 1000, "max": 6000, "max_errors": 50}}
SS_CONFIG = {"target": {"kind": "w", "n_qubits": 3}, "optimize_parameters": {"restarts": 2, "steps": 40}}
VQE_CONFIG = {"hamiltonian": {"n_qubits": 4}, "training": {"steps": 40, "restarts": 2}}
EVALUATORS = {
    "qec_memory": ("qec_repetition.py", QEC_CONFIG),
    "state_synthesis": ("w_state.py", SS_CONFIG),
    "vqe_ground_state": ("tfim_ansatz.py", VQE_CONFIG),
    "trainability_frontier": ("trainability_frontier.py", {}),
}
CONJECTURE = {
    "id": "c1", "statement": "scenario", "feature_predicate": None,
    "prediction": {"quantity": "beta_upper95", "op": "<", "value": 0.2},
    "test_family": {"rotation_axes": ["Y", "Z"], "layers": [1, 2], "rotations_per_qubit_per_layer": 2},
    "n_range": [4, 8], "circuits": 5, "points": 4,
}
FAKE_EVALUATION = {
    "status": "scored", "fitness": 1.0, "objectives": {}, "descriptors": {}, "metrics": {},
    "guardrails": [], "rejection": None, "failure": None, "compute": {},
}
TRAINABILITY_SETTINGS = {
    "samples": 32, "seed": 5, "scaling": {"qubits": [2, 3, 4], "layers": [2]}, "expressibility": {"pairs": 100},
    "entanglement": {"samples": 32}, "landscape": {"resolution": 11},
}
ALL_ANALYSES = ["gradients", "scaling", "lie", "expressibility", "entanglement", "landscape"]


def seed_program(filename: str) -> str:
    with open(os.path.join(SEEDS, filename), encoding="utf-8") as handle:
        return handle.read()


async def first(ws, start: int, accept: set[str], match=None, timeout: float = 300.0):
    """The first message after ``start`` that is an error or one of ``accept`` (and passes ``match``)."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        for message in ws.sent[start:]:
            if (message.get("type") == "error" or message.get("type") in accept) and (match is None or match(message)):
                return message
        await asyncio.sleep(0.1)
    return {"type": "TIMEOUT", "seen": [m.get("type") for m in ws.sent[start:]]}


async def ask(ws, message: dict, accept: set[str], match=None, timeout: float = 300.0) -> dict:
    start = len(ws.sent)
    ws.push(message)
    return await first(ws, start, accept, match, timeout)


def slim(message: dict) -> dict:
    return json.loads(json.dumps(message, default=str))


async def discovery(ws, out: dict) -> None:
    listing = await ask(ws, {"type": "discovery_evaluators"}, {"discovery_evaluators_result"})
    out["evaluators"] = slim(listing)
    evaluations = {}
    for index, (kind, (filename, config)) in enumerate(EVALUATORS.items()):
        reply = await ask(ws, {
            "type": "discovery_evaluate", "run_id": "r", "candidate_id": f"c{index}",
            "evaluator": {"kind": kind, "config": config}, "program": seed_program(filename), "seed": 3,
        }, {"discovery_evaluation"}, lambda m, i=index: m.get("candidate_id") == f"c{i}")
        evaluations[kind] = slim(reply)
    out["evaluate"] = evaluations
    out["evaluate_bad_config"] = slim(await ask(ws, {
        "type": "discovery_evaluate", "run_id": "r", "candidate_id": "bad",
        "evaluator": {"kind": "state_synthesis", "config": {"target": {"kind": "ghz", "n_qubits": "three"}}},
        "program": seed_program("w_state.py"), "seed": 1,
    }, {"discovery_evaluation"}))
    out["mutate"] = slim(await ask(ws, {"type": "discovery_mutate", "program": seed_program("w_state.py"), "seed": 1, "count": 2},
                                   {"discovery_mutations"}))
    out["program_key"] = slim(await ask(ws, {"type": "discovery_program_key", "program": seed_program("w_state.py")},
                                        {"discovery_program_key_result"}))
    out["conjecture_schema"] = slim(await ask(ws, {"type": "discovery_conjecture_schema"}, {"discovery_conjecture_schema_result"}))
    out["conjecture_test"] = slim(await ask(ws, {"type": "discovery_conjecture_test", "job_id": "j1", "conjecture": CONJECTURE, "seed": 1},
                                            {"discovery_conjecture_result"}))
    audits = {}
    for index, kind in enumerate(("qec_memory", "state_synthesis")):
        filename, config = EVALUATORS[kind]
        audits[kind] = slim(await ask(ws, {
            "type": "discovery_audit", "run_id": "ra", "candidate_id": f"a{index}", "evaluator": {"kind": kind, "config": config},
            "program": seed_program(filename), "seed": 3, "evaluation": FAKE_EVALUATION,
        }, {"discovery_audit_result"}, lambda m, i=index: m.get("candidate_id") == f"a{i}"))
    out["audit"] = audits


async def trainability(ws, out: dict) -> None:
    code = QISKIT_CODE + "nuclei_observable = 'Z0*Z1'\n"
    out["inspect"] = slim(await ask(ws, {"type": "trainability_inspect", "code": code, "params": {"n_qubits": 3}},
                                    {"trainability_inspected"}))
    out["lint"] = slim(await ask(ws, {"type": "trainability_lint", "code": code, "params": {"n_qubits": 3}},
                                 {"trainability_lint_result"}))
    jobs = {}
    for method in ("auto", "ppe"):
        job_id = f"t-{method}"
        reply = await ask(ws, {
            "type": "trainability_start", "job_id": job_id, "code": QISKIT_CODE, "observable": "Z0*Z1",
            "analyses": ALL_ANALYSES, "settings": {**TRAINABILITY_SETTINGS, "method": method}, "params": {"n_qubits": 3, "n_layers": 2},
        }, {"trainability_result"}, lambda m, j=job_id: m.get("job_id") == j)
        jobs[method] = slim(reply)
    out["trainability_jobs"] = jobs


def lower_level(out: dict) -> None:
    from kernel.discovery._optional import is_importable
    from kernel.discovery.evaluators import EVALUATORS as REGISTRY
    from kernel.discovery.evaluators import base, normalize_config
    from kernel.trainability import symplectic
    from kernel.trainability.symplectic import CliffordConjugator

    gates = [("H", (0,)), ("CX", (0, 1)), ("S", (1,))] * 4
    auto = CliffordConjugator(gates, 2)
    forced = None
    try:
        CliffordConjugator(gates, 2, use_stim=True)
    except RuntimeError as exc:
        forced = str(exc)
    out["symplectic"] = {"stim_attr": symplectic._stim is None, "auto_backend": auto.backend, "forced_stim_error": forced}
    out["jsonschema_absent"] = base.jsonschema is None and not is_importable("jsonschema")
    validated = {}
    for kind, spec in REGISTRY.items():
        problem = None
        try:
            normalize_config(spec, {})
            normalize_config(spec, {"definitely_not_an_option": 1})
        except base.InvalidConfig as exc:
            problem = str(exc)
        validated[kind] = problem
    out["config_validation"] = validated


def main() -> None:
    out: dict = {"blocked_import_raises": []}
    for name in ("stim", "pymatching", "sinter", "jsonschema", "pyarrow", "duckdb"):
        try:
            __import__(name)
        except ImportError:
            out["blocked_import_raises"].append(name)
    lower_level(out)

    async def run() -> None:
        async with connection() as ws:
            await discovery(ws, out)
            await trainability(ws, out)

    asyncio.run(run())
    sys.stdout.write("\nRESULT:" + json.dumps(out, default=str) + "\n")


if __name__ == "__main__":
    main()
