"""IR-facing Pauli Propagation Engine: adapter, applicability, and PPE == sampling."""

from __future__ import annotations

import math
import time

import numpy as np
import pytest

from kernel.tests._trainability_physics_helpers import Builder, hea_circuit, random_ppe_circuit
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.pauli import PauliSum, PauliTerm, parse_observable
from kernel.trainability.pauliprop import (
    PpeNotApplicable,
    ppe_applicable,
    ppe_expectation_bounds,
    ppe_frontier_curve,
    ppe_gradient_variances,
)
from kernel.trainability.reference import reference_expectation


def _obs(n: int) -> PauliSum:
    return PauliSum((PauliTerm(0.7, ((0, "Z"),)), PauliTerm(-0.4, ((0, "X"), (n - 1, "Y"))), PauliTerm(0.3, ())))


# ------------------------------------------------------------ applicability
def test_applicable_positive_includes_integer_frequency_and_cliffords():
    b = Builder(3)
    b.add("H", (0,)).add("CX", (0, 1)).add("RX", (0,), ParamRef(b.param().name, 2.0)).rot("RZZ", (1, 2))
    b.add("RY", (2,), math.pi / 2)  # constant quarter turn is Clifford
    assert ppe_applicable(b.build(), parse_observable("Z0", 3), init="uniform") == (True, None)


def _reason(circuit, init="uniform", obs="Z0"):
    ok, reason = ppe_applicable(circuit, parse_observable(obs, circuit.n_qubits), init=init)
    assert ok is False and reason
    return reason


def test_not_applicable_shared_parameter():
    gates = [IrGate("RX", (0,), (ParamRef("a"),)), IrGate("RY", (1,), (ParamRef("a"),))]
    assert "more than one rotation" in _reason(ParamCircuit(2, gates, ["a"]))


def test_not_applicable_parameter_in_two_angles_of_one_u_gate():
    c = ParamCircuit(1, [IrGate("U", (0,), (ParamRef("a"), 0.0, ParamRef("a")))], ["a"])
    assert "more than one rotation" in _reason(c)


def test_not_applicable_non_integer_frequency():
    c = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("a", 0.5),))], ["a"])
    assert "non-integer frequency" in _reason(c)


def test_not_applicable_small_init():
    b = Builder(1)
    b.rot("RX", (0,))
    assert "not uniform" in _reason(b.build(), init="small")


def test_not_applicable_non_clifford_fixed_gate():
    b = Builder(1)
    b.add("T", (0,)).rot("RX", (0,))
    assert "non-Clifford" in _reason(b.build())
    c = Builder(1)
    c.add("RX", (0,), 0.3).rot("RX", (0,))  # constant non-quarter-turn
    assert "non-Clifford" in _reason(c.build())


@pytest.mark.parametrize("name", ["CRZ", "CRX", "CP"])
def test_not_applicable_multi_pauli_generator(name):
    b = Builder(2)
    b.rot(name, (0, 1))
    assert "multi-Pauli" in _reason(b.build())


def test_not_applicable_affine_offset():
    c = ParamCircuit(1, [IrGate("RX", (0,), (ParamRef("a", 1.0, 0.5),))], ["a"])
    assert "affine" in _reason(c)


def test_not_applicable_beyond_ir_limit():
    c = ParamCircuit(300, [], [])
    ok, reason = ppe_applicable(c, PauliSum(()), init="uniform")
    assert not ok and "IR limit" in reason


def test_forced_variances_raise_clear_error_when_not_applicable():
    b = Builder(1)
    b.add("T", (0,)).rot("RX", (0,))
    with pytest.raises(PpeNotApplicable) as exc:
        ppe_gradient_variances(b.build(), parse_observable("Z0", 1))
    assert exc.value.code == "ppe_not_applicable"


# ------------------------------------------------------------------ adapter
def test_expectation_matches_reference_on_random_circuits():
    """Adapter correctness: U (time order), P, frequencies 2 and -1, constant quarter turns, Cliffords."""
    rng = np.random.default_rng(11)
    for _ in range(40):
        n = int(rng.integers(2, 6))
        c = random_ppe_circuit(rng, n, int(rng.integers(4, 26)))
        v = rng.uniform(0, 2 * math.pi, len(c.parameters))
        res = ppe_expectation_bounds(c, _obs(n), v)
        assert res["method"] == "pauli_propagation_exact"
        assert res["value"] == pytest.approx(reference_expectation(c, v, _obs(n)), abs=1e-9)


def test_parameter_name_order_follows_circuit_parameters_not_gate_order():
    gates = [IrGate("RX", (0,), (ParamRef("b"),)), IrGate("RY", (0,), (ParamRef("a"),))]
    c = ParamCircuit(1, gates, ["a", "b"])  # declared order differs from gate order
    v = np.array([0.4, 1.1])
    res = ppe_expectation_bounds(c, parse_observable("Z0", 1), v)
    assert res["value"] == pytest.approx(reference_expectation(c, v, parse_observable("Z0", 1)), abs=1e-12)
    out = ppe_gradient_variances(c, parse_observable("Z0", 1))
    assert [r["name"] for r in out["per_parameter"]] == ["a", "b"]


def test_expectation_allows_shared_parameters_at_fixed_values():
    gates = [IrGate("RX", (0,), (ParamRef("a"),)), IrGate("RY", (0,), (ParamRef("a", 2.0),))]
    c = ParamCircuit(1, gates, ["a"])
    v = np.array([0.7])
    res = ppe_expectation_bounds(c, parse_observable("Z0", 1), v)
    assert res["value"] == pytest.approx(reference_expectation(c, v, parse_observable("Z0", 1)), abs=1e-12)


def test_expectation_rejects_wrong_value_count():
    b = Builder(1)
    b.rot("RX", (0,))
    with pytest.raises(Exception, match="expected 1 values"):
        ppe_expectation_bounds(b.build(), parse_observable("Z0", 1), [0.1, 0.2])


# ------------------------------------------------------------- closed forms
def test_single_anticommuting_rotation_has_variance_one_half():
    b = Builder(1)
    b.rot("RX", (0,))
    out = ppe_gradient_variances(b.build(), parse_observable("Z0", 1))
    row = out["per_parameter"][0]
    assert row["name"] == "t0" and row["variance"] == pytest.approx(0.5)
    assert row["interval"] == [pytest.approx(0.5), pytest.approx(0.5)]
    assert out["method"] == "pauli_propagation_exact"


def test_commuting_rotation_is_dead():
    b = Builder(1)
    b.rot("RZ", (0,))
    row = ppe_gradient_variances(b.build(), parse_observable("Z0", 1))["per_parameter"][0]
    assert row["variance"] == 0.0 and row["dead"] is True


@pytest.mark.parametrize("n", [2, 5, 8, 20, 64])
def test_global_z_single_layer_hea_has_variance_two_to_minus_n(n):
    """RY layer + CZ brick, <Z^n>: CZ commutes with Z-strings, so C = prod cos(t_q); Var = 2^-n."""
    out = ppe_gradient_variances(hea_circuit(n, 1), parse_observable("preset:global_z", n), min_weight_abs=0.0)
    assert out["variance_mean"] == pytest.approx(2.0 ** -n, rel=1e-12)
    assert out["method"] == "pauli_propagation_exact"


# ------------------------------------------------------- PPE == sampling
def _sampled_variance(circuit, observable, samples=3000, seed=5):
    rng = np.random.default_rng(seed)
    v = rng.uniform(0, 2 * math.pi, (samples, len(circuit.parameters)))
    _, g = compile_circuit(circuit, backend="numpy").value_and_grad(v, observable)
    boot = rng.multinomial(samples, np.full(samples, 1 / samples), size=1000).astype(float)
    s1, s2 = boot @ g, boot @ (g * g)
    var_b = np.maximum((s2 - s1 * s1 / samples) / (samples - 1), 0)
    return g.var(axis=0, ddof=1), np.percentile(var_b, [2.5, 97.5], axis=0), np.percentile(var_b.mean(1), [2.5, 97.5])


@pytest.mark.parametrize("seed,n,gates", [(1, 3, 14), (2, 5, 22), (3, 6, 30), (4, 8, 26), (5, 10, 28), (6, 12, 24)])
def test_ppe_variance_matches_compiled_sampling(seed, n, gates):
    rng = np.random.default_rng(seed)
    c = random_ppe_circuit(rng, n, gates)
    obs = _obs(n)
    ppe = ppe_gradient_variances(c, obs, min_weight_abs=0.0)
    assert ppe["method"] == "pauli_propagation_exact"
    sv, ci, mean_ci = _sampled_variance(c, obs)
    exact = np.array([r["variance"] for r in ppe["per_parameter"]])
    inside = ((exact >= ci[0]) & (exact <= ci[1])) | ((exact == 0) & (sv < 1e-12))  # dead: numerically 0
    assert inside.mean() >= 0.85   # 95% intervals: robust against a few per-parameter misses
    half = (mean_ci[1] - mean_ci[0]) / 2
    assert mean_ci[0] - 0.5 * half <= ppe["variance_mean"] <= mean_ci[1] + 0.5 * half


# ----------------------------------------------------------------- bounds
def test_truncation_intervals_always_contain_the_exact_value():
    rng = np.random.default_rng(3)
    c = random_ppe_circuit(rng, 7, 40)
    obs = _obs(7)
    exact = ppe_gradient_variances(c, obs, min_weight_abs=0.0)
    ev = np.array([r["variance"] for r in exact["per_parameter"]])
    assert exact["method"] == "pauli_propagation_exact"
    for kwargs in ({"max_frontier": 6}, {"max_weight": 2}, {"min_weight_abs": 0.2}):
        out = ppe_gradient_variances(c, obs, **kwargs)
        assert out["method"] == "pauli_propagation_bounded"
        for r, e in zip(out["per_parameter"], ev):
            assert r["interval"][0] - 1e-12 <= e <= r["interval"][1] + 1e-12
    v = rng.uniform(0, 2 * math.pi, len(c.parameters))
    val = reference_expectation(c, v, obs)
    for kwargs in ({"max_frontier": 5}, {"max_weight": 1}):
        res = ppe_expectation_bounds(c, obs, v, **kwargs)
        assert res["interval"][0] - 1e-12 <= val <= res["interval"][1] + 1e-12


def test_frontier_curve_wrapper_shrinks_the_interval():
    rng = np.random.default_rng(4)
    c = random_ppe_circuit(rng, 6, 40)
    v = rng.uniform(0, 2 * math.pi, len(c.parameters))
    curve = ppe_frontier_curve(c, _obs(6), v, frontier_sizes=[4, 64, 100_000])
    widths = [p["width"] for p in curve]
    assert widths[0] >= widths[1] >= widths[2] - 1e-12 and widths[2] == pytest.approx(0.0, abs=1e-12)
    assert curve[2]["value"] == pytest.approx(reference_expectation(c, v, _obs(6)), abs=1e-9)


@pytest.mark.parametrize("n", [64, 128])
def test_large_shallow_local_observable_finishes_within_budget(n):
    c = hea_circuit(n, 2)
    t0 = time.perf_counter()
    out = ppe_gradient_variances(c, parse_observable("preset:local_z", n), time_budget_s=20.0)
    assert time.perf_counter() - t0 < 20.0
    assert out["method"] == "pauli_propagation_exact"
    assert out["variance_mean"] > 0.1 / n**2   # local cost: Var ~ n^-2 (1/n-weighted terms)


# ---- PH-LOW: constant RZZ/RXX/RYY/RZX at k*pi/2 are Clifford for the PPE
@pytest.mark.parametrize("name", ["RZZ", "RXX", "RYY", "RZX"])
@pytest.mark.parametrize("k", [1, 2, 3])
def test_constant_quarter_turn_two_qubit_rotation_is_accepted_and_exact(name, k):
    b = Builder(3)
    b.rot("RY", (0,)).rot("RX", (1,)).rot("RY", (2,))
    b.add(name, (0, 2), k * math.pi / 2)
    b.rot("RX", (0,)).rot("RZ", (2,)).rot("RY", (1,))
    c = b.build()
    obs = PauliSum((PauliTerm(1.0, ((0, "Z"), (2, "Z"))), PauliTerm(0.5, ((1, "X"),))))
    ok, why = ppe_applicable(c, obs, init="uniform")
    assert ok, why
    res = ppe_gradient_variances(c, obs, min_weight_abs=0)
    assert res["method"] == "pauli_propagation_exact"
    rng = np.random.default_rng(k)
    vals = rng.uniform(0, 2 * math.pi, (30000, len(c.parameters)))
    _, g = compile_circuit(c).value_and_grad(vals, obs)
    for row, emp, se in zip(res["per_parameter"], g.var(axis=0), g.var(axis=0) * math.sqrt(2 / 30000)):
        assert abs(row["variance"] - emp) <= 5 * se + 1e-9, (name, k, row, emp)
