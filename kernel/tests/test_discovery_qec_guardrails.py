"""Adversarial cheating candidates for qec_memory: each is rejected by exactly one guardrail."""

from __future__ import annotations

import pytest

stim = pytest.importorskip("stim")
pytest.importorskip("pymatching")

from kernel.discovery.evaluators import EVALUATORS, effective_config, normalize_config  # noqa: E402
from kernel.discovery.seeds.qec_repetition import build  # noqa: E402

SPEC = EVALUATORS["qec_memory"]
ORDER = [
    "parse", "noiseless", "gate_set", "qubit_budget", "has_observable",
    "deterministic", "duration", "decodable", "nontrivial_observable", "fault_distance",
]


def run(texts: list[str], overrides: dict | None = None, stage: str = "full", cache_dir=None):
    config = normalize_config(SPEC, overrides or {})
    artifacts = [{"call_index": i, "artifact": {"circuit_text": t}} for i, t in enumerate(texts)]
    return SPEC.score(effective_config(SPEC, config, stage), artifacts, 1, stage=stage, cache_dir=cache_dir)


def good(d: int, rounds: int | None = None) -> str:
    return str(build(d, d if rounds is None else rounds))


def assert_rejected_by(core, guardrail: str) -> None:
    assert core.status == "rejected", core.metrics
    assert core.fitness is None and core.to_dict()["fitness"] is None
    assert core.rejection["guardrail"] == guardrail
    statuses = {g["id"]: g["status"] for g in core.guardrails}
    assert list(statuses) == ORDER, "every guardrail is always listed"
    index = ORDER.index(guardrail)
    assert [statuses[g] for g in ORDER[:index]] == ["pass"] * index
    assert statuses[guardrail] == "fail"
    assert [statuses[g] for g in ORDER[index + 1:]] == ["skipped"] * (len(ORDER) - index - 1)


def test_baseline_good_circuits_pass_every_guardrail():
    core = run([good(3), good(5)])
    assert core.status == "scored"
    assert [g["status"] for g in core.guardrails] == ["pass"] * 10


def test_parse():
    assert_rejected_by(run(["NOT_A_GATE 0", good(5)]), "parse")


def test_noiseless_injected_noise():
    assert_rejected_by(run([good(3) + "\nDEPOLARIZE1(0.001) 0", good(5)]), "noiseless")


def test_noiseless_measurement_flip_argument():
    cheat = good(3).replace("M 0 2 4", "M(0.01) 0 2 4")
    assert cheat != good(3)
    assert_rejected_by(run([cheat, good(5)]), "noiseless")


@pytest.mark.parametrize("extra", ["X_ERROR(0.001) 0", "PAULI_CHANNEL_1(0.1,0.1,0.1) 0", "E(0.01) X0", "HERALDED_ERASE(0.1) 0"])
def test_noiseless_every_channel_family(extra):
    assert_rejected_by(run([good(3) + "\n" + extra, good(5)]), "noiseless")


def test_gate_set_disallowed_gate():
    assert_rejected_by(run([good(3) + "\nISWAP 0 1", good(5)]), "gate_set")


def test_gate_set_mpp_is_not_allowed():
    assert_rejected_by(run([good(3) + "\nMPP X0*X2", good(5)]), "gate_set")


def test_qubit_budget_too_many_qubits():
    assert_rejected_by(run([good(3) + "\nH 500", good(5)]), "qubit_budget")


def test_qubit_budget_respects_config():
    assert_rejected_by(run([good(3), good(5)], {"max_qubits": 8}), "qubit_budget")


def test_qubit_budget_repeat_bomb_is_rejected_not_expanded():
    bomb = "REPEAT 1000000000 {\n    REPEAT 1000000000 {\n        TICK\n    }\n}\n" + good(3)
    assert_rejected_by(run([bomb, good(5)]), "qubit_budget")


def test_has_observable_none():
    cheat = "\n".join(line for line in good(3).splitlines() if not line.startswith("OBSERVABLE_INCLUDE"))
    assert_rejected_by(run([cheat, good(5)]), "has_observable")


def test_has_observable_pauli_only_target():
    cheat = "\n".join(line for line in good(3).splitlines() if not line.startswith("OBSERVABLE_INCLUDE"))
    cheat += "\nOBSERVABLE_INCLUDE(0) X0"
    assert_rejected_by(run([cheat, good(5)]), "has_observable")


def test_deterministic_random_detector():
    cheat = "R 0\nH 0\nTICK\nM 0\nDETECTOR rec[-1]\nOBSERVABLE_INCLUDE(0) rec[-1]"
    assert_rejected_by(run([cheat, good(5)]), "deterministic")


def test_duration_too_few_rounds():
    assert_rejected_by(run([good(3, 1), good(5, 1)]), "duration")


def _hyperedge(rounds: int) -> str:
    body = "".join("M 0\nDETECTOR rec[-1]\nDETECTOR rec[-1]\nDETECTOR rec[-1]\nTICK\n" for _ in range(rounds))
    return f"R 0\nTICK\n{body}OBSERVABLE_INCLUDE(0) rec[-1]"


def test_decodable_hyperedge_model():
    assert_rejected_by(run([_hyperedge(3), _hyperedge(5)]), "decodable")


def test_nontrivial_observable_cancelling_targets():
    cheat = good(3).replace("OBSERVABLE_INCLUDE(0) rec[-3]", "OBSERVABLE_INCLUDE(0) rec[-3] rec[-3]")
    assert cheat != good(3)
    assert_rejected_by(run([cheat, good(5)]), "nontrivial_observable")


def test_fault_distance_cheat_claims_d5_but_is_d3():
    cheat = good(3, 5)  # ignores the requested distance
    core = run([cheat], {"distances": [5]})
    assert_rejected_by(core, "fault_distance")
    assert core.rejection["message"] == "Requested d=5 but an undetectable logical error of weight 3 exists."


def test_fault_distance_deferred_in_screen_stage():
    core = run([good(3, 5)], {"distances": [5]}, stage="screen")
    statuses = {g["id"]: g for g in core.guardrails}
    assert statuses["fault_distance"]["status"] == "skipped"
    assert statuses["fault_distance"]["detail"] == "skipped (deferred to full stage)"
    assert core.status == "scored"  # cheaters can pass screen; the runner must run `full` before promotion


def test_fault_distance_result_is_cached_by_noisy_circuit(tmp_path):
    from kernel.discovery import distance

    distance._memory_cache.clear()
    run([good(3), good(5)], cache_dir=str(tmp_path))
    files = list(tmp_path.glob("fault-distance-*.json"))
    assert len(files) == 2
    distance._memory_cache.clear()
    core = run([good(3), good(5)], cache_dir=str(tmp_path))  # served from disk
    assert core.status == "scored"
    assert len(distance._memory_cache) == 2


def test_bounded_search_for_large_distance_is_a_warning_not_a_pass():
    core = run([str(stim.Circuit.generated("surface_code:rotated_memory_z", distance=7, rounds=2))],
               {"distances": [7], "rounds": 2, "shots": {"min": 1000, "max": 1000, "max_errors": 5}})
    record = next(g for g in core.guardrails if g["id"] == "fault_distance")
    assert record["status"] == "warn"
    assert "verified only up to the search bounds" in record["detail"]
