"""Shared plumbing for the Red Queen audit tests (seeds, cached evaluations, sandbox artifacts)."""

from __future__ import annotations

import copy
import functools
import os
import tempfile
from typing import Any

from kernel.discovery.audits.exploits import evaluate_fixture
from kernel.discovery.constants import CANDIDATE_CPU_DEFAULT
from kernel.discovery.evaluators import EVALUATORS, effective_config, normalize_config
from kernel.discovery.sandbox import default_request, run_candidate

SEED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "discovery", "seeds")
QEC_CONFIG = {"distances": [3, 5], "shots": {"min": 1000, "max": 6000, "max_errors": 50}}
SS_CONFIG = {"target": {"kind": "w", "n_qubits": 3}, "optimize_parameters": {"restarts": 2, "steps": 60}}
VQE_CONFIG = {"hamiltonian": {"n_qubits": 4}, "training": {"steps": 80, "restarts": 2}}

#: (evaluator kind, seed file, config)
HONEST_SEEDS: dict[str, tuple[str, str, dict[str, Any]]] = {
    "qec_repetition": ("qec_memory", "qec_repetition.py", QEC_CONFIG),
    "w_state": ("state_synthesis", "w_state.py", SS_CONFIG),
    "tfim_ansatz": ("vqe_ground_state", "tfim_ansatz.py", VQE_CONFIG),
}


def read_seed(filename: str) -> str:
    with open(os.path.join(SEED_DIR, filename), encoding="utf-8") as handle:
        return handle.read()


def make_fixture(kind: str, program: str, config: dict[str, Any], fixture_id: str = "audit-test", seed: int = 11) -> dict[str, Any]:
    return {
        "id": fixture_id, "title": "t", "evaluator": {"kind": kind, "config": copy.deepcopy(config)}, "program": program,
        "entry": "build", "seed": seed, "stage": "full", "discovered_by": "hand", "expect": "consistent", "notes": "",
    }


@functools.lru_cache(maxsize=None)
def _cached_evaluation(name: str) -> str:
    import json

    kind, filename, config = HONEST_SEEDS[name]
    with tempfile.TemporaryDirectory() as cache:
        record = evaluate_fixture(make_fixture(kind, read_seed(filename), config, name), cache)
    return json.dumps(record)


def honest_evaluation(name: str) -> dict[str, Any]:
    import json

    return json.loads(_cached_evaluation(name))


@functools.lru_cache(maxsize=None)
def _cached_artifacts(name: str) -> str:
    import json

    kind, filename, config = HONEST_SEEDS[name]
    spec = EVALUATORS[kind]
    cfg = effective_config(spec, normalize_config(spec, config), "full")
    reply = run_candidate(
        default_request(spec.task, read_seed(filename), spec.default_entry, spec.calls(cfg), CANDIDATE_CPU_DEFAULT),
        wall_seconds=120,
    )
    assert reply["status"] == "ok", reply
    return json.dumps(reply["artifacts"])


def honest_artifacts(name: str) -> list[dict[str, Any]]:
    import json

    return json.loads(_cached_artifacts(name))


def full_config(kind: str, config: dict[str, Any]) -> dict[str, Any]:
    spec = EVALUATORS[kind]
    return effective_config(spec, normalize_config(spec, config), "full")
