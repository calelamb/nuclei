"""vqe_ground_state evaluator: guardrails, training, variational bound, determinism."""

from __future__ import annotations

import json

import numpy as np
import pytest

pytest.importorskip("qiskit")
from qiskit import QuantumCircuit  # noqa: E402
from qiskit.circuit import ParameterVector  # noqa: E402

from kernel.discovery.evaluators import EVALUATORS, InvalidConfig, effective_config, normalize_config  # noqa: E402
from kernel.discovery.evaluators import vqe_ground_state as vqe  # noqa: E402
from kernel.discovery.evaluators.vqe_ground_state import SPEC  # noqa: E402
from kernel.discovery.gradient_map import gradient_variances  # noqa: E402
from kernel.trainability.convert import from_object  # noqa: E402
from kernel.trainability.pauli import parse_observable  # noqa: E402

N = 4
BASE = {"hamiltonian": {"kind": "tfim", "n_qubits": N, "h": 1.0}}
FAST = {"training": {"restarts": 2, "steps": 120}}
GUARDRAILS = ["ir_conversion", "qubit_count", "parameter_budget", "has_parameters",
              "trainability_prefilter", "variational_bound"]


def config(overrides=None, stage="full"):
    merged = {**BASE, **FAST, **(overrides or {})}
    return effective_config(SPEC, normalize_config(SPEC, merged), stage)


def artifacts(qc):
    return [{"call_index": 0, "artifact": {"ir": from_object(qc).to_json(), "framework": "qiskit"}}]


def score(qc, overrides=None, seed=1, stage="full"):
    return SPEC.score(config(overrides, stage), artifacts(qc), seed, None, None, stage=stage).to_dict()


def ry_cz_ansatz(n=N, layers=2):
    qc = QuantumCircuit(n)
    theta = ParameterVector("t", n * (layers + 1))
    k = 0
    for _ in range(layers):
        for q in range(n):
            qc.ry(theta[k], q)
            k += 1
        for q in range(n - 1):
            qc.cz(q, q + 1)
    for q in range(n):
        qc.ry(theta[k], q)
        k += 1
    return qc


def failed_guardrails(result):
    return [g["id"] for g in result["guardrails"] if g["status"] == "fail"]


def rejected_by(result, guardrail):
    assert result["status"] == "rejected", result
    assert result["rejection"]["guardrail"] == guardrail
    assert failed_guardrails(result) == [guardrail]
    ids = [g["id"] for g in result["guardrails"]]
    assert ids == GUARDRAILS
    after = ids.index(guardrail) + 1
    assert all(g["status"] == "skipped" for g in result["guardrails"][after:])
    assert all(g["status"] == "pass" for g in result["guardrails"][: after - 1])


# --- spec / config ----------------------------------------------------------


def test_registered_with_spec_summary():
    assert EVALUATORS["vqe_ground_state"] is SPEC
    wire = SPEC.to_json()
    assert [o["key"] for o in wire["objectives"]] == ["relative_energy_error", "parameters"]
    assert [(d["key"], d["min"], d["max"], d["default_bins"]) for d in wire["descriptors"]] == [
        ("parameters", 0, 200, 8), ("two_qubit_gates", 0, 128, 8),
    ]
    assert wire["default_config"]["training"] == {"steps": 200, "restarts": 4, "learning_rate": 0.05, "init": "uniform"}
    assert wire["default_config"]["trainability_prefilter"] == {"enabled": True, "samples": 64, "min_variance": 1e-5}
    assert wire["default_config"]["max_parameters"] == 200 and wire["default_config"]["cost_weight"] == 0.002


def test_stage_overrides():
    screen = effective_config(SPEC, normalize_config(SPEC, BASE), "screen")
    assert screen["training"]["restarts"] == 1 and screen["training"]["steps"] == 50
    assert screen["training"]["learning_rate"] == 0.05
    assert screen["trainability_prefilter"] == {"enabled": True, "samples": 32, "min_variance": 1e-5}
    full = effective_config(SPEC, normalize_config(SPEC, BASE), "full")
    assert full["training"]["restarts"] == 4 and full["trainability_prefilter"]["samples"] == 64


def test_invalid_configs():
    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, {"hamiltonian": {"kind": "pauli", "n_qubits": 3}})
    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, {"hamiltonian": {"kind": "pauli", "n_qubits": 2, "pauli": "Z0*Z7"}})
    with pytest.raises(InvalidConfig):
        normalize_config(SPEC, {"training": {"init": "gaussian"}})


def test_large_n_without_scipy_is_rejected_at_validation(monkeypatch):
    monkeypatch.setattr(vqe, "_has_scipy", lambda: False)
    with pytest.raises(InvalidConfig, match="scipy"):
        normalize_config(SPEC, {"hamiltonian": {"kind": "tfim", "n_qubits": 11}})
    assert normalize_config(SPEC, {"hamiltonian": {"kind": "tfim", "n_qubits": 10}})


# --- scoring ----------------------------------------------------------------


def test_trained_ansatz_scores_and_reports_metrics():
    result = score(ry_cz_ansatz())
    assert result["status"] == "scored", result
    metrics = result["metrics"]
    assert metrics["e0"] == pytest.approx(1 - 1 / np.sin(np.pi / (2 * (2 * N + 1))), abs=1e-10)
    assert metrics["e_best"] >= metrics["e0"] - 1e-8
    assert metrics["relative_energy_error"] < 0.02
    assert metrics["n_parameters"] == 12 and result["descriptors"] == {"parameters": 12, "two_qubit_gates": 6}
    assert 1 < len(metrics["curve"]) <= 50
    assert metrics["curve"][-1] == pytest.approx(min(metrics["curve"])) and metrics["curve"][0] > metrics["curve"][-1]
    assert metrics["prefilter"]["variance_mean"] > 1e-5 and metrics["prefilter"]["samples"] == 64
    assert [g["id"] for g in result["guardrails"]] == GUARDRAILS
    assert all(g["status"] == "pass" for g in result["guardrails"])
    expected = -np.log10(metrics["relative_energy_error"]) - 0.002 * 12
    assert result["fitness"] == pytest.approx(expected)
    assert result["objectives"]["parameters"]["value"] == 12
    assert result["objectives"]["relative_energy_error"]["value"] == metrics["relative_energy_error"]
    assert result["metrics"]["gradient_map"]["objective"] == "energy"
    json.dumps(result, allow_nan=False)


def test_screen_stage_trains_one_short_restart():
    result = score(ry_cz_ansatz(), stage="screen")
    assert result["status"] == "scored"
    assert len(result["metrics"]["restart_energies"]) == 1
    assert result["metrics"]["prefilter"]["samples"] == 32


def test_curve_is_capped_at_fifty_points():
    result = score(ry_cz_ansatz(), {"training": {"restarts": 1, "steps": 400}})
    assert len(result["metrics"]["curve"]) <= 50


def test_small_init_trains_and_prefilter_uses_small_draw():
    result = score(ry_cz_ansatz(), {"training": {"restarts": 1, "steps": 60, "init": "small"}})
    assert result["status"] == "scored"
    assert result["metrics"]["prefilter"]["init"] == "small"


def test_seeded_determinism():
    qc = ry_cz_ansatz()
    first = score(qc, seed=5)
    assert first == score(qc, seed=5)
    assert first["metrics"]["restart_energies"] != score(qc, seed=6)["metrics"]["restart_energies"]


def test_heisenberg_and_pauli_hamiltonians():
    heis = score(ry_cz_ansatz(2, 2), {"hamiltonian": {"kind": "heisenberg", "n_qubits": 2}})
    assert heis["metrics"]["e0"] == pytest.approx(-3.0)
    custom = score(ry_cz_ansatz(2, 2), {"hamiltonian": {"kind": "pauli", "n_qubits": 2, "pauli": "Z0*Z1 + 0.5*X0"}})
    assert custom["status"] == "scored"


# --- guardrails: each adversarial candidate is rejected by exactly one ------


def test_initialize_cheat_is_rejected_by_ir_conversion():
    artifact = {"ir": None, "ir_error": {"code": "unsupported_gate", "message": "gate 'initialize' is not supported"}}
    result = SPEC.score(config(), [{"call_index": 0, "artifact": artifact}], 1, None, None).to_dict()
    rejected_by(result, "ir_conversion")


def test_wrong_qubit_count_is_rejected_by_qubit_count():
    rejected_by(score(ry_cz_ansatz(N + 1)), "qubit_count")


def test_too_many_parameters_is_rejected_by_parameter_budget():
    qc = QuantumCircuit(N)
    theta = ParameterVector("t", 9)
    for i in range(9):
        qc.ry(theta[i], i % N)
    rejected_by(score(qc, {"max_parameters": 8}), "parameter_budget")


def test_no_parameters_is_rejected_by_has_parameters():
    qc = QuantumCircuit(N)
    qc.h(0)
    qc.cx(0, 1)
    rejected_by(score(qc), "has_parameters")


def global_cost_random_circuit(n=8, layers=24):
    """RX/RY/RZ on every qubit plus a brickwork CZ layer, repeated."""
    qc = QuantumCircuit(n)
    theta = ParameterVector("t", 3 * n * layers)
    k = 0
    for layer in range(layers):
        for q in range(n):
            for gate in (qc.rx, qc.ry, qc.rz):
                gate(theta[k], q)
                k += 1
        for q in range(layer % 2, n - 1, 2):
            qc.cz(q, q + 1)
    return qc


def test_barren_plateau_is_rejected_by_trainability_prefilter():
    # At n = 8 a deep circuit with a global cost has mean gradient variance ~2e-3, far above the
    # 1e-5 default (2^-n is not yet tiny), so the threshold is raised to 5e-3 for this test.
    # The shallow local-cost control below clears the same threshold (~1e-2).
    n = 8
    global_cost = "*".join(f"Z{q}" for q in range(n))
    overrides = {
        "hamiltonian": {"kind": "pauli", "n_qubits": n, "pauli": global_cost},
        "trainability_prefilter": {"min_variance": 5e-3},
        "max_parameters": 600,
        "training": {"restarts": 1, "steps": 2},
    }
    result = score(global_cost_random_circuit(n, layers=16), overrides)
    rejected_by(result, "trainability_prefilter")
    assert "barren plateau at initialization" in result["rejection"]["message"]
    assert result["rejection"]["message"].count("e-0") >= 1  # reports the measured variance
    local = {**overrides, "hamiltonian": {"kind": "pauli", "n_qubits": n, "pauli": "Z0"}}
    assert score(global_cost_random_circuit(n, layers=2), local)["status"] == "scored"


def test_prefilter_can_be_disabled():
    n = 8
    overrides = {
        "hamiltonian": {"kind": "pauli", "n_qubits": n, "pauli": "*".join(f"Z{q}" for q in range(n))},
        "trainability_prefilter": {"min_variance": 5e-3, "enabled": False},
        "max_parameters": 600,
        "training": {"restarts": 1, "steps": 2},
    }
    assert score(global_cost_random_circuit(n, layers=16), overrides)["status"] == "scored"


def test_prefilter_calls_trainability_gradient_statistics_with_sampling(monkeypatch):
    analyses = pytest.importorskip("kernel.trainability.analyses")
    calls = []
    real = analyses.gradient_statistics

    def spy(*args, **kwargs):
        calls.append(kwargs)
        return real(*args, **kwargs)

    monkeypatch.setattr(analyses, "gradient_statistics", spy)
    result = score(ry_cz_ansatz())
    assert result["status"] == "scored"
    assert calls and calls[0]["method"] == "sampling" and calls[0]["samples"] == 64
    assert result["metrics"]["prefilter"]["source"] == "analyses"


def test_prefilter_fallback_matches_direct_sampling():
    circuit = from_object(ry_cz_ansatz())
    observable = parse_observable("Z0*Z1 + X0", N)
    stats = gradient_variances(circuit, observable, samples=32, seed=1, prefer_analyses=False)
    assert stats["source"] == "direct" and stats["variance_mean"] > 0


# --- variational bound ------------------------------------------------------


def test_variational_bound_violation_is_failed_never_scored(monkeypatch):
    real = vqe.exact_ground_energy
    monkeypatch.setattr(vqe, "exact_ground_energy", lambda ps, n: real(ps, n) + 5.0)  # E0 above every reachable energy
    result = score(ry_cz_ansatz())
    assert result["status"] == "failed"
    assert result["fitness"] is None
    assert result["failure"]["code"] == "variational_bound_violated"
    assert result["failure"]["stage"] == "score"
    bound = result["guardrails"][-1]
    assert bound["id"] == "variational_bound" and bound["status"] == "fail"
    assert result["rejection"] is None


def test_bound_is_checked_against_tolerance_not_exact_equality(monkeypatch):
    real = vqe.exact_ground_energy
    # A tiny shift inside 1e-8 must not fail an honest run.
    monkeypatch.setattr(vqe, "exact_ground_energy", lambda ps, n: real(ps, n) + 1e-10)
    assert score(ry_cz_ansatz())["status"] == "scored"
