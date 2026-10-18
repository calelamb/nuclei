"""Regression tests for the two evaluator holes Red Queen found (PRD 14 addendum F).

* qec distance cheater: a hyperedge hides a weight-5 logical in a "d=7" circuit from the bounded search.
* vqe parameter laundering: pre-trained fixed rotations were free under the parameters objective.
Plus the ``best_theta`` over-claim checks both audits now hard-fail on.
"""

from __future__ import annotations

import copy
import math
import os
import tempfile
import threading
import time

import pytest

stim = pytest.importorskip("stim")
pytest.importorskip("pymatching")
pytest.importorskip("qiskit")

from kernel.discovery import distance  # noqa: E402
from kernel.discovery.audits import qec_memory as qec_audit  # noqa: E402
from kernel.discovery.audits import state_synthesis as ss_audit  # noqa: E402
from kernel.discovery.audits import vqe_ground_state as vqe_audit  # noqa: E402
from kernel.discovery.audits.exploits import evaluate_fixture, load_fixtures  # noqa: E402
from kernel.discovery.evaluators import EVALUATORS, effective_config, normalize_config  # noqa: E402
from kernel.discovery.evaluators import qec_guardrails  # noqa: E402
from kernel.discovery.evaluators._circuit_common import (  # noqa: E402
    effective_parameter_counts, promote_fixed_angles,
)
from kernel.discovery.evaluators.qec_memory import DISTANCE_UNVERIFIED_PENALTY  # noqa: E402
from kernel.discovery.noise import apply_noise  # noqa: E402
from kernel.discovery.seeds.qec_repetition import build as honest_build  # noqa: E402
from kernel.tests._discovery_audit_helpers import (  # noqa: E402
    full_config, honest_artifacts, honest_evaluation, make_fixture,
)
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef  # noqa: E402

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "exploits")
FIXTURES = {f["id"]: f for f in load_fixtures(FIXTURE_DIR)}
QEC = EVALUATORS["qec_memory"]
QEC_CONFIG = {"distances": [3, 5, 7], "shots": {"min": 1000, "max": 2000, "max_errors": 20}}


@pytest.fixture(autouse=True)
def _process_isolation(monkeypatch):
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    from kernel.discovery import isolation

    isolation.reset_for_tests()
    distance._memory_cache.clear()
    yield
    isolation.reset_for_tests()


# --- qec: hyperedge distance cheater ------------------------------------------------------------------


def cheater_texts() -> list[str]:
    scope: dict = {}
    exec(FIXTURES["qec-distance-cheater-bus-fanout"]["program"], scope)  # noqa: S102 - our own fixture
    return [str(scope["build"](d, d)) for d in (3, 5, 7)]


def honest_texts() -> list[str]:
    return [str(honest_build(d, d)) for d in (3, 5, 7)]


def qec_score(texts: list[str], stage: str = "full", overrides: dict | None = None):
    config = normalize_config(QEC, {**QEC_CONFIG, **(overrides or {})})
    artifacts = [{"call_index": i, "artifact": {"circuit_text": t}} for i, t in enumerate(texts)]
    return QEC.score(effective_config(QEC, config, stage), artifacts, 7, stage=stage)


def force_bounded_miss(monkeypatch, weight: int = 7):
    """Make the bounded search blind, as the old evaluator was: it reports the claimed distance, unverified."""
    monkeypatch.setattr(
        qec_guardrails, "fault_distance",
        lambda noisy, d, **kw: distance.DistanceResult(weight if d == 7 else d, "graphlike+pruned", False, 0.0, "bounded search"),
    )


def test_pruning_bounds_come_from_the_dem_not_a_constant():
    noisy = apply_noise(stim.Circuit(cheater_texts()[2]), "uniform", 1e-3, 10.0)
    assert distance.max_symptom_degree(noisy) == 6  # the bus-fanout hyperedge; the old fixed bound was 3
    assert distance.fault_distance(noisy, 7).weight == 5


def test_evaluator_rejects_the_distance_cheater():
    core = qec_score(cheater_texts())
    assert core.status == "rejected" and core.rejection["guardrail"] == "fault_distance"
    assert core.rejection["message"] == "Requested d=7 but an undetectable logical error of weight 5 exists."


def test_honest_repetition_code_is_verified_without_penalty():
    core = qec_score(honest_texts())
    assert core.status == "scored"
    assert core.metrics["distance_verified"] is True and core.metrics["distance_penalty"] == 0.0
    assert all(row["distance_verified"] and row["fault_distance"] == d for row, d in zip(core.metrics["per_distance"], (3, 5, 7)))


def test_unverified_distance_is_penalized_below_the_honest_code(monkeypatch):
    honest = qec_score(honest_texts())
    force_bounded_miss(monkeypatch)
    cheat = qec_score(cheater_texts())
    assert cheat.status == "scored"  # the old evaluator's view: only a warning
    assert cheat.metrics["distance_verified"] is False
    assert cheat.metrics["distance_penalty"] == DISTANCE_UNVERIFIED_PENALTY > 0
    warn = next(g for g in cheat.guardrails if g["id"] == "fault_distance")
    assert warn["status"] == "warn" and "penalized" in warn["detail"]
    assert cheat.fitness < honest.fitness


def test_penalty_is_exactly_the_documented_amount(monkeypatch):
    honest = qec_score(honest_texts())
    force_bounded_miss(monkeypatch, weight=7)
    unverified_honest = qec_score(honest_texts())  # same circuits, search forced incomplete
    assert math.isclose(honest.fitness - unverified_honest.fitness, DISTANCE_UNVERIFIED_PENALTY, abs_tol=1e-9)


def test_confirm_runs_exact_search_and_fails_a_lower_weight_logical(monkeypatch):
    force_bounded_miss(monkeypatch)
    core = qec_score(cheater_texts(), stage="confirm")
    assert core.status == "rejected" and core.rejection["guardrail"] == "fault_distance"
    assert "confirm-stage exact search found" in core.rejection["message"] and "weight 5" in core.rejection["message"]


def test_confirm_verifies_an_honest_circuit_the_bounded_search_could_not(monkeypatch):
    force_bounded_miss(monkeypatch)
    core = qec_score(honest_texts(), stage="confirm")
    assert core.status == "scored" and core.metrics["distance_verified"] is True
    assert core.metrics["distance_penalty"] == 0.0
    assert core.metrics["per_distance"][2]["fault_distance_method"] == "exact_confirm"


def test_confirm_with_an_incomplete_exact_search_warns_and_keeps_the_penalty(monkeypatch):
    force_bounded_miss(monkeypatch)
    monkeypatch.setattr(
        qec_guardrails, "exact_search",
        lambda text, budget, cancel=None: distance.ExactResult(None, False, 1.0, None, "exact search exceeded its 120 s budget"),
    )
    core = qec_score(honest_texts(), stage="confirm")
    record = next(g for g in core.guardrails if g["id"] == "fault_distance")
    assert core.status == "scored" and record["status"] == "warn" and "incomplete" in record["detail"]
    assert core.metrics["distance_verified"] is False and core.metrics["distance_penalty"] == DISTANCE_UNVERIFIED_PENALTY


def test_screen_stage_is_unverified_and_penalized():
    core = qec_score(honest_texts(), stage="screen")
    assert core.metrics["distance_verified"] is False and core.metrics["distance_penalty"] == DISTANCE_UNVERIFIED_PENALTY


def test_audit_exact_search_still_catches_what_a_blind_evaluator_misses(monkeypatch):
    force_bounded_miss(monkeypatch)
    texts = cheater_texts()
    core = qec_score(texts)
    artifacts = [{"call_index": i, "artifact": {"circuit_text": t}} for i, t in enumerate(texts)]
    record = qec_audit.audit(
        full_config("qec_memory", QEC_CONFIG), artifacts, 5, evaluation=copy.deepcopy(core.to_dict()), cancel=threading.Event(),
    )
    (exact,) = [c for c in record["checks"] if c["id"] == "exact_fault_distance"]
    assert exact["status"] == "fail" and "weight 5" in exact["detail"]


def test_evaluator_and_audit_share_one_exact_search():
    from kernel.discovery.audits import _exact_distance

    assert _exact_distance.ExactResult is distance.ExactResult
    result = _exact_distance.exact_fault_distance(str(apply_noise(stim.Circuit(cheater_texts()[2]), "uniform", 1e-3, 10.0)), 30)
    assert result.complete and result.weight == 5 and result.max_degree == 6


@pytest.mark.parametrize(("d", "limit_s"), [(7, 5.0), (9, 15.0)])
def test_honest_evaluation_stays_practical(d, limit_s):
    """Honest d=7..9 fault-distance checks must remain cheap (idle-machine target 5 s / 15 s; 3x slack for CI)."""
    noisy = apply_noise(honest_build(d, d), "uniform", 1e-3, 10.0)
    started = time.monotonic()
    result = distance.fault_distance(noisy, d)
    assert result.weight == d and result.complete
    assert time.monotonic() - started < 3 * limit_s


# --- vqe: parameter laundering ------------------------------------------------------------------------


def gate(name, angle, q=0):
    return IrGate(name, (q,), (angle,))


def test_effective_parameters_charge_fixed_non_clifford_angles_only():
    clifford = [gate("RY", k * math.pi / 2) for k in range(-4, 5)]
    t_like = [gate("RZ", math.pi / 4), gate("RY", 3 * math.pi / 4), gate("P", -math.pi / 4)]
    near_clifford = [gate("RY", 3.141593)]  # six-digit pi is still Clifford
    laundered = [gate("RY", 0.734), gate("RX", 1.1), gate("RZ", math.pi / 2 + 0.01)]
    circuit = ParamCircuit(1, [*clifford, *t_like, *near_clifford, *laundered, gate("RY", ParamRef("t"))], ["t"])
    assert effective_parameter_counts(circuit) == {
        "n_free_parameters": 1, "n_fixed_nonclifford_angles": 3, "effective_parameters": 4,
    }


def test_shared_parameter_with_hidden_offsets_is_charged_but_clean_tying_is_free():
    gates = [
        gate("RY", ParamRef("t")),                       # first use: free (an offset here is absorbed by t)
        gate("RY", ParamRef("t", 2.0, math.pi / 2)),     # integer coefficient, Clifford offset: legitimate tying
        gate("RY", ParamRef("t", 1.0, 0.7)),             # hidden pre-trained gap
        gate("RY", ParamRef("t", 0.37, 0.0)),            # hidden pre-trained ratio
    ]
    counts = effective_parameter_counts(ParamCircuit(1, gates, ["t"]))
    assert counts["n_fixed_nonclifford_angles"] == 2 and counts["effective_parameters"] == 3
    promoted = promote_fixed_angles(ParamCircuit(1, gates, ["t"]))
    assert len(promoted.parameters) == 3 and promoted.parameters[0] == "t"


def test_promotion_is_identity_for_honest_ansatzes():
    from kernel.discovery.seeds.tfim_ansatz import build
    from kernel.trainability.convert import from_object

    circuit = from_object(build(4))
    promoted = promote_fixed_angles(circuit)
    assert promoted.parameters == circuit.parameters and promoted.gates == circuit.gates


VQE_FIXTURE = FIXTURES["vqe-fixed-rotation-parameter-laundering"]


def test_laundering_fixture_scores_strictly_below_the_honest_seed():
    honest = honest_evaluation("tfim_ansatz")
    with tempfile.TemporaryDirectory() as cache:
        cheat = evaluate_fixture(VQE_FIXTURE, cache)
    assert cheat["status"] == "scored" and honest["status"] == "scored"
    assert honest["metrics"]["effective_parameters"] == honest["metrics"]["n_parameters"] == 12
    metrics = cheat["metrics"]
    assert metrics["n_parameters"] == 1 and metrics["n_fixed_nonclifford_angles"] == 9
    assert metrics["effective_parameters"] == 10 and cheat["objectives"]["parameters"]["value"] == 10
    assert cheat["fitness"] < honest["fitness"]


def test_parameter_budget_guardrail_counts_effective_parameters():
    fixture = copy.deepcopy(VQE_FIXTURE)
    fixture["evaluator"]["config"]["max_parameters"] = 5
    with tempfile.TemporaryDirectory() as cache:
        record = evaluate_fixture(fixture, cache)
    assert record["status"] == "rejected" and record["rejection"]["guardrail"] == "parameter_budget"
    assert "1 free + 9 fixed" not in record["rejection"]["message"] and "10 effective parameters" in record["rejection"]["message"]


def test_a_circuit_with_only_hard_coded_angles_still_has_no_free_parameters():
    from kernel.discovery.seeds.tfim_ansatz import build  # noqa: F401  (import check only)

    program = (
        "from qiskit import QuantumCircuit\n"
        "def build(n):\n    qc = QuantumCircuit(n)\n    [qc.ry(0.7 + 0.1 * q, q) for q in range(n)]\n    return qc\n"
    )
    fixture = make_fixture("vqe_ground_state", program, {"hamiltonian": {"n_qubits": 3}, "training": {"steps": 20, "restarts": 1}})
    with tempfile.TemporaryDirectory() as cache:
        record = evaluate_fixture(fixture, cache)
    assert record["status"] == "rejected" and record["rejection"]["guardrail"] == "has_parameters"


def test_laundering_audit_check_flags_the_fixture_and_passes_honest_seeds():
    cheat_artifacts, cheat_eval = None, None
    with tempfile.TemporaryDirectory() as cache:
        cheat_eval = evaluate_fixture(VQE_FIXTURE, cache)
    from kernel.discovery.audits.exploits import audit_fixture

    with tempfile.TemporaryDirectory() as cache:
        audit = audit_fixture(VQE_FIXTURE, cheat_eval, cache)
    laundering = next(c for c in audit["checks"] if c["id"] == "parameter_laundering")
    assert laundering["status"] == "fail" and "pre-trained" in laundering["detail"]
    honest = vqe_audit.audit(
        full_config("vqe_ground_state", {"hamiltonian": {"n_qubits": 4}, "training": {"steps": 80, "restarts": 2}}),
        honest_artifacts("tfim_ansatz"), 3, evaluation=honest_evaluation("tfim_ansatz"), cancel=threading.Event(),
    )
    assert next(c for c in honest["checks"] if c["id"] == "parameter_laundering")["status"] == "pass"
    assert cheat_artifacts is None


def test_laundering_audit_fails_an_evaluator_that_undercharges():
    evaluation = copy.deepcopy(honest_evaluation("tfim_ansatz"))
    cfg = full_config("vqe_ground_state", {"hamiltonian": {"n_qubits": 4}, "training": {"steps": 80, "restarts": 2}})
    circuit = ParamCircuit(4, [gate("RY", ParamRef("t")), *[gate("RY", 0.3 + q, q) for q in range(4)]], ["t"])
    evaluation["metrics"]["effective_parameters"] = 1
    status, detail = vqe_audit._check_laundering(circuit, evaluation)
    assert status == "fail" and "charged 1 effective" in detail
    assert cfg  # config builds


# --- best_theta exposure and the audits' hard-fail over-claim checks ---------------------------------


def test_vqe_metrics_expose_best_theta_in_parameter_order():
    metrics = honest_evaluation("tfim_ansatz")["metrics"]
    assert len(metrics["best_theta"]) == len(metrics["parameter_names"]) == 12
    assert all(isinstance(x, float) for x in metrics["best_theta"])


def vqe_audit_status(evaluation: dict, check_id: str) -> str:
    cfg = full_config("vqe_ground_state", {"hamiltonian": {"n_qubits": 4}, "training": {"steps": 80, "restarts": 2}})
    record = vqe_audit.audit(cfg, honest_artifacts("tfim_ansatz"), 3, evaluation=evaluation, cancel=threading.Event())
    return next(c for c in record["checks"] if c["id"] == check_id)["status"]


def test_vqe_audit_replays_best_theta_and_hard_fails_an_overclaimed_energy():
    honest = honest_evaluation("tfim_ansatz")
    assert vqe_audit_status(honest, "best_theta_replay") == "pass"
    for delta in (-0.01, 0.01):  # over-claim and under-claim both disagree beyond 1e-6
        tampered = copy.deepcopy(honest)
        tampered["metrics"]["e_best"] += delta
        assert vqe_audit_status(tampered, "best_theta_replay") == "fail"
    wrong_length = copy.deepcopy(honest)
    wrong_length["metrics"]["best_theta"] = wrong_length["metrics"]["best_theta"][:-1]
    assert vqe_audit_status(wrong_length, "best_theta_replay") == "fail"


STATE_PROGRAM = (
    "from qiskit import QuantumCircuit\nfrom qiskit.circuit import ParameterVector\n"
    "def build(n):\n    qc = QuantumCircuit(n)\n    t = ParameterVector('t', 3)\n    qc.ry(t[0], 0)\n"
    "    qc.cx(0, 1)\n    qc.ry(t[1], 1)\n    qc.cx(1, 2)\n    qc.ry(t[2], 2)\n    return qc\n"
)
STATE_CONFIG = {"target": {"kind": "ghz", "n_qubits": 3}, "optimize_parameters": {"restarts": 2, "steps": 60}}


@pytest.fixture(scope="module")
def state_case():
    fixture = make_fixture("state_synthesis", STATE_PROGRAM, STATE_CONFIG, "state-theta")
    with tempfile.TemporaryDirectory() as cache:
        evaluation = evaluate_fixture(fixture, cache)
    assert evaluation["status"] == "scored", evaluation
    from kernel.discovery.sandbox import default_request, run_candidate

    spec = EVALUATORS["state_synthesis"]
    cfg = full_config("state_synthesis", STATE_CONFIG)
    reply = run_candidate(default_request(spec.task, STATE_PROGRAM, spec.default_entry, spec.calls(cfg), 60), wall_seconds=120)
    assert reply["status"] == "ok", reply
    return cfg, reply["artifacts"], evaluation


def ss_status(case, evaluation: dict, check_id: str) -> str:
    cfg, artifacts, _ = case
    record = ss_audit.audit(cfg, artifacts, 3, evaluation=evaluation, cancel=threading.Event())
    return next(c for c in record["checks"] if c["id"] == check_id)["status"]


def test_state_metrics_expose_best_theta_and_the_audit_hard_fails_a_disagreeing_fidelity(state_case):
    evaluation = state_case[2]
    metrics = evaluation["metrics"]
    assert len(metrics["best_theta"]) == len(metrics["parameter_names"]) == 3
    assert ss_status(state_case, evaluation, "fidelity_reproduced") == "pass"
    for delta in (-0.05, 0.05):
        tampered = copy.deepcopy(evaluation)
        tampered["metrics"]["fidelity"] = min(1.0, metrics["fidelity"] + delta) if delta > 0 else metrics["fidelity"] + delta
        if tampered["metrics"]["fidelity"] != metrics["fidelity"]:
            assert ss_status(state_case, tampered, "fidelity_reproduced") == "fail"
    short = copy.deepcopy(evaluation)
    short["metrics"]["best_theta"] = short["metrics"]["best_theta"][:2]
    assert ss_status(state_case, short, "fidelity_reproduced") == "fail"


def test_state_synthesis_does_not_charge_fixed_rotations():
    """Its cost is the gate cost, so a hard-coded angle is already priced as the gate it is (W-state seed)."""
    program = open(os.path.join(os.path.dirname(__file__), "..", "discovery", "seeds", "w_state.py"), encoding="utf-8").read()
    fixture = make_fixture("state_synthesis", program, {"target": {"kind": "w", "n_qubits": 3}}, "ss-w")
    with tempfile.TemporaryDirectory() as cache:
        record = evaluate_fixture(fixture, cache)
    assert record["status"] == "scored" and record["metrics"]["n_fixed_nonclifford_angles"] > 0
    assert record["metrics"]["best_theta"] == [] and record["metrics"]["meets_threshold"]
    assert record["metrics"]["cost_kind"] == "two_qubit_gates"
