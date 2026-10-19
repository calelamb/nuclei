"""state_synthesis evaluator: guardrails, fidelity gradient, scoring, determinism."""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("qiskit")
from qiskit import QuantumCircuit  # noqa: E402
from qiskit.circuit import ParameterVector  # noqa: E402

from kernel.discovery.evaluators import EVALUATORS, effective_config, normalize_config  # noqa: E402
from kernel.discovery.evaluators._fidelity import fidelity_from_states, fidelity_value_and_grad  # noqa: E402
from kernel.discovery.evaluators.state_synthesis import MAX_PARAMETERS, SPEC  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402
from kernel.discovery.targets import ghz, w_state  # noqa: E402
from kernel.trainability.compiler import compile_circuit  # noqa: E402
from kernel.trainability.convert import from_object, from_qiskit  # noqa: E402

GHZ3 = {"target": {"kind": "ghz", "n_qubits": 3}}


def config(overrides=None, stage="full"):
    return effective_config(SPEC, normalize_config(SPEC, overrides or GHZ3), stage)


def artifacts(qc):
    return [{"call_index": 0, "artifact": {"ir": from_object(qc).to_json(), "framework": "qiskit"}}]


def score(qc, overrides=None, seed=1, stage="full"):
    return SPEC.score(config(overrides, stage), artifacts(qc), seed, None, None, stage=stage).to_dict()


def ghz_circuit(n=3):
    qc = QuantumCircuit(n)
    qc.h(0)
    for q in range(n - 1):
        qc.cx(q, q + 1)
    return qc


def failed_guardrail(result):
    return [g["id"] for g in result["guardrails"] if g["status"] == "fail"]


# --- spec -------------------------------------------------------------------


def test_registered_with_spec_summary():
    assert EVALUATORS["state_synthesis"] is SPEC
    wire = SPEC.to_json()
    assert [o["key"] for o in wire["objectives"]] == ["infidelity", "cost"]
    assert [(d["key"], d["min"], d["max"], d["default_bins"]) for d in wire["descriptors"]] == [
        ("two_qubit_gates", 0, 64, 8), ("depth", 0, 64, 8),
    ]
    assert wire["task"] == "quantum_circuit"


def test_stage_overrides():
    assert config(stage="screen")["optimize_parameters"] == {"restarts": 1, "steps": 60, "learning_rate": 0.05}
    assert config(stage="full")["optimize_parameters"]["restarts"] == 8
    assert config(stage="full")["optimize_parameters"]["steps"] == 300
    assert config(stage="screen")["target"]["kind"] == "ghz"


def test_invalid_config_is_rejected():
    from kernel.discovery.evaluators import InvalidConfig

    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, {"target": {"kind": "nope", "n_qubits": 3}})
    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, {"target": {"kind": "dicke", "n_qubits": 3, "k": 5}})


# --- scoring ----------------------------------------------------------------


def test_exact_ghz_scores_full_marks_minus_cost():
    result = score(ghz_circuit())
    assert result["status"] == "scored"
    assert result["metrics"]["fidelity"] == pytest.approx(1.0)
    assert result["objectives"]["infidelity"]["value"] == pytest.approx(0.0, abs=1e-12)
    assert result["objectives"]["cost"]["value"] == 2
    assert result["fitness"] == pytest.approx(10.0 - 0.1 * 2)
    assert result["descriptors"] == {"two_qubit_gates": 2, "depth": 3}
    assert result["metrics"]["optimized"] is False
    assert "gradient_map" not in result["metrics"]
    assert [g["status"] for g in result["guardrails"]] == ["pass"] * 5


def test_cost_kinds_follow_canonical_decomposition():
    qc = QuantumCircuit(3)
    qc.h(0)
    qc.ccx(0, 1, 2)
    qc.t(0)
    over = {**GHZ3, "allowed_gates": ["H", "T", "CCX"]}
    assert score(qc, {**over, "cost": "two_qubit_gates"})["objectives"]["cost"]["value"] == 6
    assert score(qc, {**over, "cost": "t_count"})["objectives"]["cost"]["value"] == 8
    depth = score(qc, {**over, "cost": "depth"})
    assert depth["objectives"]["cost"]["value"] == depth["descriptors"]["depth"] == 8


def test_wrong_state_is_scored_below_threshold():
    qc = QuantumCircuit(3)
    qc.h(0)
    result = score(qc)
    assert result["status"] == "scored"
    assert result["metrics"]["fidelity"] == pytest.approx(0.25)
    assert result["metrics"]["meets_threshold"] is False
    assert result["fitness"] == pytest.approx(10 * 0.25 / 0.999)


def test_w_target_distinguishes_from_ghz():
    qc = ghz_circuit()
    result = score(qc, {"target": {"kind": "w", "n_qubits": 3}})
    assert result["metrics"]["fidelity"] == pytest.approx(0.0, abs=1e-12)


def parameterized_ghz():
    qc = QuantumCircuit(3)
    theta = ParameterVector("t", 3)
    qc.ry(theta[0], 0)
    qc.cx(0, 1)
    qc.ry(theta[1], 1)
    qc.cx(1, 2)
    qc.ry(theta[2], 2)
    return qc


def test_parameters_are_optimized_by_the_evaluator():
    result = score(parameterized_ghz(), seed=3)
    assert result["status"] == "scored"
    assert result["metrics"]["optimized"] is True
    assert result["metrics"]["fidelity"] > 0.999
    assert len(result["metrics"]["restart_fidelities"]) == 8
    gradient = result["metrics"]["gradient_map"]
    assert gradient["objective"] == "scaled_fidelity" and gradient["method"] == "statevector_sampling"
    assert len(gradient["lines"]) == 0  # converted without tracing: no source lines, nothing guessed


def test_screen_stage_uses_one_short_restart():
    result = score(parameterized_ghz(), stage="screen")
    assert len(result["metrics"]["restart_fidelities"]) == 1


def test_seeded_determinism():
    qc = parameterized_ghz()
    first = score(qc, seed=11)
    assert first == score(qc, seed=11)
    assert first["metrics"]["restart_fidelities"] != score(qc, seed=12)["metrics"]["restart_fidelities"]


# --- fidelity gradient (the chosen method) vs finite differences ------------


def gradient_test_circuit():
    qc = QuantumCircuit(3)
    theta = ParameterVector("t", 8)
    qc.ry(theta[0], 0)
    qc.rx(theta[1], 1)
    qc.cx(0, 1)
    qc.crx(theta[2], 1, 2)
    qc.rz(theta[3], 2)
    qc.h(2)
    qc.cz(0, 2)
    qc.ry(theta[4], 2)
    qc.rzz(theta[5], 0, 1)
    qc.cp(theta[6], 1, 2)
    qc.ry(2 * theta[0] + 0.3, 1)  # shared parameter, scaled with an offset
    qc.p(theta[7], 0)
    return qc


@pytest.mark.parametrize("target", [w_state(3), ghz(3)])
def test_fidelity_adjoint_gradient_matches_finite_differences(target):
    program = compile_circuit(from_qiskit(gradient_test_circuit()))
    values = np.random.default_rng(1).uniform(0, 2 * np.pi, (4, 8))
    fidelity, grad = fidelity_value_and_grad(program, values, target)
    assert np.allclose(fidelity, fidelity_from_states(program.states(values), target), atol=1e-12)
    eps = 1e-6
    numeric = np.zeros_like(grad)
    for j in range(8):
        step = np.zeros(8)
        step[j] = eps
        plus = fidelity_from_states(program.states(values + step), target)
        minus = fidelity_from_states(program.states(values - step), target)
        numeric[:, j] = (plus - minus) / (2 * eps)
    assert np.abs(numeric - grad).max() < 1e-8


# --- guardrails: each adversarial candidate is rejected by exactly one ------


def rejected_by(result, guardrail):
    assert result["status"] == "rejected", result
    assert result["rejection"]["guardrail"] == guardrail
    assert failed_guardrail(result) == [guardrail]
    ids = [g["id"] for g in result["guardrails"]]
    assert ids == ["ir_conversion", "gate_set", "qubit_count", "no_measurement", "parameter_budget"]
    after = ids.index(guardrail) + 1
    assert all(g["status"] == "skipped" for g in result["guardrails"][after:])
    assert all(g["status"] == "pass" for g in result["guardrails"][: after - 1])


def test_initialize_cheat_is_rejected_by_ir_conversion():
    program = (
        "import numpy as np\nfrom qiskit import QuantumCircuit\n"
        "def build(n):\n    qc = QuantumCircuit(n)\n    v = np.zeros(2**n, dtype=complex)\n"
        "    v[0] = v[-1] = 2**-0.5\n    qc.initialize(v, range(n))\n    return qc\n"
    )
    request = default_request("quantum_circuit", program, "build", [{"args": [3], "kwargs": {}}])
    response = run_candidate(request, wall_seconds=60)
    assert response["status"] == "ok"  # a candidate defect, not a sandbox failure
    result = SPEC.score(config(), response["artifacts"], 1, None, None, stage="full").to_dict()
    rejected_by(result, "ir_conversion")
    assert result["rejection"]["message"].startswith("unsupported_gate")


def test_state_preparation_cheat_is_rejected_by_ir_conversion():
    program = (
        "from qiskit import QuantumCircuit\nfrom qiskit.circuit.library import StatePreparation\n"
        "def build(n):\n    qc = QuantumCircuit(n)\n    qc.append(StatePreparation([1, 0, 0, 0, 0, 0, 0, 1j]) , range(n))\n    return qc\n"
    )
    response = run_candidate(
        default_request("quantum_circuit", program, "build", [{"args": [3], "kwargs": {}}]), wall_seconds=60
    )
    result = SPEC.score(config(), response["artifacts"], 1, None, None, stage="full").to_dict()
    rejected_by(result, "ir_conversion")


def test_unitary_gate_cheat_is_rejected_by_ir_conversion():
    program = (
        "import numpy as np\nfrom qiskit import QuantumCircuit\n"
        "def build(n):\n    qc = QuantumCircuit(n)\n    qc.unitary(np.eye(2**n), range(n))\n    return qc\n"
    )
    response = run_candidate(
        default_request("quantum_circuit", program, "build", [{"args": [3], "kwargs": {}}]), wall_seconds=60
    )
    rejected_by(SPEC.score(config(), response["artifacts"], 1, None, None, stage="full").to_dict(), "ir_conversion")


def test_malformed_artifact_is_rejected_by_ir_conversion():
    result = SPEC.score(config(), [{"call_index": 0, "artifact": {"ir": {"n_qubits": 0}}}], 1, None, None).to_dict()
    rejected_by(result, "ir_conversion")
    assert SPEC.score(config(), [], 1, None, None).to_dict()["rejection"]["guardrail"] == "ir_conversion"


def test_disallowed_gate_is_rejected_by_gate_set():
    qc = ghz_circuit()
    qc.swap(0, 2)
    result = score(qc)
    rejected_by(result, "gate_set")
    assert "SWAP" in result["rejection"]["message"]


def test_wrong_qubit_count_is_rejected_by_qubit_count():
    rejected_by(score(ghz_circuit(4)), "qubit_count")


def test_measurement_is_rejected_by_no_measurement():
    qc = ghz_circuit()
    qc.measure_all()
    result = score(qc)
    rejected_by(result, "no_measurement")
    assert "measurement" in result["rejection"]["message"]


def test_too_many_parameters_is_rejected_by_parameter_budget():
    qc = QuantumCircuit(3)
    theta = ParameterVector("t", MAX_PARAMETERS + 1)
    for i in range(MAX_PARAMETERS + 1):
        qc.ry(theta[i], i % 3)
    rejected_by(score(qc), "parameter_budget")


def test_exactly_the_budget_is_accepted():
    qc = QuantumCircuit(3)
    theta = ParameterVector("t", MAX_PARAMETERS)
    for i in range(MAX_PARAMETERS):
        qc.ry(theta[i], i % 3)
    result = score(qc, {**GHZ3, "optimize_parameters": {"restarts": 1, "steps": 2}})
    assert result["status"] == "scored"


def test_result_is_json_serialisable():
    import json

    json.dumps(score(parameterized_ghz()), allow_nan=False)
