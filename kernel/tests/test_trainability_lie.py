"""lie_algebra: known results through the IR, dense cross-checks, prediction vs measurement."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from kernel.tests._trainability_physics_helpers import (
    Builder,
    brickwork_hea,
    hea_circuit,
    random_ppe_circuit,
    two_axis_hea,
)
from kernel.trainability import lie_core
from kernel.trainability._analysis_common import AnalysisCancelled, AnalysisError
from kernel.trainability._circuit_walk import Rotation, walk
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.lie import lie_algebra
from kernel.trainability.pauli import parse_observable, pauli_sum_matrix, PauliSum, PauliTerm
from kernel.trainability.reference import reference_state

SPEC_KEYS = {"status", "reason", "n_qubits", "dimension", "dimension_lower_bound", "max_dimension", "classification",
             "generators", "fixed_gates", "purity", "predicted_variance", "prediction_applicable", "assumptions",
             "simulability", "elapsed_ms"}


def _free_fermion(n: int, layers: int = 1) -> ParamCircuit:
    b = Builder(n)
    for _ in range(layers):
        for q in range(n):
            b.rot("RX", (q,))
        for q in range(n - 1):
            b.rot("RZZ", (q, q + 1))
    return b.build()


def _strip(res: dict) -> str:
    return json.dumps({k: v for k, v in res.items() if k != "elapsed_ms"}, sort_keys=True)


# ------------------------------------------------------- required known results
@pytest.mark.parametrize("n", [2, 3, 4, 5, 6])
def test_free_fermion_chain_has_dimension_n_times_2n_minus_1(n):
    res = lie_algebra(_free_fermion(n))
    assert res["status"] == "complete" and res["dimension"] == n * (2 * n - 1)
    assert res["path"] == "pauli_strings"
    assert res["classification"]["confidence"] == "exact_dimension_match"
    assert res["classification"]["label"] == f"so({2 * n})"
    assert res["simulability"]["kind"] == "g_sim_feasible" and "Goh et al. 2023" in res["simulability"]["summary"]


def test_brickwork_ry_cz_hea_n3_is_so8_dimension_28():
    res = lie_algebra(brickwork_hea(3, 4))
    assert res["dimension"] == 28 and res["classification"]["label"] == "so(8)"
    assert res["classification"]["family"] == "so"
    assert res["simulability"]["kind"] == "g_sim_feasible"   # 28 <= 4 n^2 = 36


def test_plain_repeated_ladder_gives_12_not_28():
    """A repeated identical CZ ladder squares to the identity, so the DLA stays small (documented)."""
    assert lie_algebra(hea_circuit(3, 3))["dimension"] == 12
    assert lie_algebra(brickwork_hea(3, 2))["dimension"] == 7     # too shallow to reach so(8)


def test_x_y_plus_zz_n3_is_su8_dimension_63():
    b = Builder(3)
    for q in range(3):
        b.rot("RX", (q,))
        b.rot("RY", (q,))
    for q in range(2):
        b.rot("RZZ", (q, q + 1))
    res = lie_algebra(b.build())
    assert res["dimension"] == 63 and res["classification"]["label"] == "su(8)"
    assert res["simulability"]["kind"] == "exponential_dla"


def test_single_z_generator_has_dimension_one():
    b = Builder(1)
    b.rot("RZ", (0,))
    res = lie_algebra(b.build(), observable=parse_observable("Z0", 1))
    assert res["dimension"] == 1 and res["classification"]["family"] == "other"
    assert res["abelian"] is True and res["prediction_applicable"] is False


# ----------------------------------------------- dense brute-force cross-checks
def _prefix_unitary(circuit: ParamCircuit, upto_item_gate: int) -> np.ndarray:
    """Dense product of the fixed gates strictly before ``upto_item_gate`` (via the reference oracle)."""
    n = circuit.n_qubits
    prefix = ParamCircuit(n, [g for g in circuit.gates[:upto_item_gate]
                              if all(not isinstance(a, ParamRef) for a in g.angles)], [])
    cols = []
    for i in range(1 << n):
        e = np.zeros(1 << n, dtype=complex)
        e[i] = 1
        cols.append(reference_state(prefix, np.zeros(0), e))
    return np.array(cols).T


def _brute_force_dimension(circuit: ParamCircuit) -> int:
    """Independent DLA dimension: dense effective generators from the reference oracle, then ``dense_closure``."""
    n = circuit.n_qubits
    per_param: dict[str, np.ndarray] = {}
    for gi, g in enumerate(circuit.gates):
        for a, term_gen in ((a, None) for a in g.angles if isinstance(a, ParamRef)):
            assert g.name != "U"
            gen = GATE_SPECS[g.name].generator(g.qubits)
            m = pauli_sum_matrix(PauliSum(tuple(t for t in gen.terms if t.ops)), n)
            v = _prefix_unitary(circuit, gi)
            per_param[a.name] = per_param.get(a.name, 0) + a.coeff * (v.conj().T @ m @ v)
    return lie_core.dense_closure(list(per_param.values()))


def _qaoa_ring(n: int, p: int) -> ParamCircuit:
    params = [f"{k}{i}" for i in range(p) for k in ("g", "b")]
    gates = [IrGate("H", (q,)) for q in range(n)]
    for i in range(p):
        gates += [IrGate("RZZ", (q, (q + 1) % n), (ParamRef(f"g{i}"),)) for q in range(n)]
        gates += [IrGate("RX", (q,), (ParamRef(f"b{i}"),)) for q in range(n)]
    return ParamCircuit(n, gates, params)


def test_shared_parameter_qaoa_ring_matches_dense_brute_force_n4():
    c = _qaoa_ring(4, 2)
    res = lie_algebra(c)
    assert res["path"] == "pauli_sums" and res["generators"]["count"] == 4
    assert res["dimension"] == _brute_force_dimension(c)
    assert res["dimension"] > res["generators"]["count"] > 0     # a nontrivial closure


def test_multi_pauli_generator_crz_uses_sum_path_and_matches_dense():
    b = Builder(3)
    b.rot("RX", (0,)).rot("CRZ", (0, 1)).rot("RY", (1,)).rot("CP", (1, 2)).rot("RX", (2,))
    c = b.build()
    res = lie_algebra(c)
    assert res["path"] == "pauli_sums" and res["dimension"] == _brute_force_dimension(c)


def test_random_clifford_plus_rotation_circuits_match_dense_brute_force():
    rng = np.random.default_rng(21)
    checked = 0
    for _ in range(14):
        c = random_ppe_circuit(rng, 3, int(rng.integers(5, 16)), with_u=False)
        if not c.parameters:
            continue
        assert lie_algebra(c)["dimension"] == _brute_force_dimension(c)
        checked += 1
    assert checked >= 10


def test_dense_fallback_for_non_clifford_fixed_gates_n3():
    b = Builder(3)
    b.add("RY", (0,), 0.37).add("T", (1,)).rot("RX", (0,)).add("CH", (0, 1)).rot("RZZ", (0, 1)).rot("RY", (2,))
    b.add("RZZ", (1, 2), 0.2).rot("RX", (1,)).rot("RXX", (1, 2))
    c = b.build()
    res = lie_algebra(c)
    assert res["path"] == "dense" and res["fixed_gates"] == {"clifford": False, "handled_by": "dense"}
    assert res["dimension"] == _brute_force_dimension(c)
    assert res["purity"]["observable"] is None and res["prediction_applicable"] is False
    assert any("Dense fallback" in a for a in res["assumptions"])


def test_non_clifford_fixed_gates_above_six_qubits_are_unsupported():
    b = Builder(7)
    b.add("T", (0,))
    for q in range(7):
        b.rot("RX", (q,))
    res = lie_algebra(b.build())
    assert res["status"] == "unsupported" and "dense fallback" in res["reason"] and res["dimension"] is None
    assert res["simulability"]["kind"] == "unknown"


def test_stim_conjugation_scales_to_n20_with_cliffords():
    n = 20
    b = Builder(n)
    for q in range(n):
        b.add("H", (q,))
    for q in range(n - 1):
        b.add("CX", (q, q + 1))
    for q in range(n):
        b.rot("RX", (q,))
    for q in range(n - 1):
        b.rot("RZZ", (q, q + 1))
    res = lie_algebra(b.build(), time_budget_s=30.0)
    assert res["status"] == "complete" and res["fixed_gates"]["handled_by"] == "clifford_conjugation"
    # the same Clifford V precedes every rotation, so conjugation is an automorphism of the algebra
    assert res["dimension"] == n * (2 * n - 1)


# --------------------------------------------------------- output contract
def test_output_matches_the_spec_shape():
    res = lie_algebra(_free_fermion(3), observable=parse_observable("Z0*Z1", 3))
    assert SPEC_KEYS <= set(res)
    assert set(res["classification"]) >= {"label", "family", "confidence", "note"}
    assert set(res["generators"]) == {"count", "unique", "examples"} and res["generators"]["count"] == 5
    assert set(res["purity"]) == {"initial_state", "observable", "observable_in_algebra", "state_in_algebra"}
    assert set(res["simulability"]) == {"kind", "summary"} and res["max_dimension"] == 4096
    assert res["fixed_gates"] == {"clifford": True, "handled_by": "none"}
    assert "X0" in res["generators"]["examples"] and "Z0Z1" in res["generators"]["examples"]
    assert res["assumptions"] and all(isinstance(a, str) for a in res["assumptions"])
    json.dumps(res, allow_nan=False)


def test_unique_generators_and_fixed_gate_modes():
    b = Builder(2)
    b.rot("RX", (0,)).rot("RX", (0,)).rot("RZZ", (0, 1))
    res = lie_algebra(b.build())
    assert res["generators"]["count"] == 3 and res["generators"]["unique"] == 2
    c = Builder(2)
    c.add("H", (0,)).rot("RZ", (0,))
    assert lie_algebra(c.build())["fixed_gates"] == {"clifford": True, "handled_by": "clifford_conjugation"}


def test_no_parameters_gives_trivial_algebra():
    res = lie_algebra(ParamCircuit(2, [IrGate("H", (0,))], []))
    assert res["dimension"] == 0 and res["status"] == "complete" and res["classification"]["label"] == "trivial"


def test_truncation_reports_lower_bound_and_unknown_classification():
    res = lie_algebra(_free_fermion(6), max_dimension=20)
    assert res["status"] == "truncated" and res["dimension"] is None and res["dimension_lower_bound"] <= 20
    assert res["reason"] == "max_dimension" and res["classification"]["confidence"] == "none"
    assert res["simulability"]["kind"] == "unknown" and res["prediction_applicable"] is False
    assert any("lower bound" in a for a in res["assumptions"])


def test_time_budget_truncates_and_cancel_raises():
    big = two_axis_hea(8, 4)
    res = lie_algebra(big, time_budget_s=0.03, max_dimension=100_000)
    assert res["status"] == "truncated" and res["reason"] in ("time_budget", "max_dimension")
    with pytest.raises(AnalysisCancelled):
        lie_algebra(big, cancel=lambda: True)


def test_invalid_observable_qubit():
    with pytest.raises(AnalysisError):
        lie_algebra(_free_fermion(2), observable=parse_observable("Z4", 5))


def test_deterministic_result():
    c = _qaoa_ring(4, 2)
    obs = parse_observable("preset:local_z", 4)
    assert _strip(lie_algebra(c, observable=obs)) == _strip(lie_algebra(c, observable=obs))
    assert _strip(lie_algebra(brickwork_hea(3, 4))) == _strip(lie_algebra(brickwork_hea(3, 4)))


# ------------------------------------------------- purity + prediction science
@pytest.mark.parametrize("n,spec", [(3, "Z0*Z1"), (4, "Z0*Z1"), (4, "X0"), (3, "X1")])
def test_variance_prediction_matches_measured_cost_variance_for_deep_free_fermion_circuits(n, spec):
    c = _free_fermion(n, layers=12)
    obs = parse_observable(spec, n)
    res = lie_algebra(c, observable=obs)
    assert res["prediction_applicable"] is True and res["purity"]["observable_in_algebra"] is True
    rng = np.random.default_rng(0)
    vals = rng.uniform(0, 2 * math.pi, (6000, len(c.parameters)))
    measured = compile_circuit(c).expectations(vals, obs).var()
    assert res["predicted_variance"] == pytest.approx(measured, rel=0.12)


def test_prediction_not_applicable_when_neither_observable_nor_state_in_algebra():
    res = lie_algebra(_free_fermion(3), observable=parse_observable("Z0", 3))   # single Z is not in the algebra
    assert res["purity"]["observable_in_algebra"] is False and res["purity"]["state_in_algebra"] is False
    assert res["predicted_variance"] is None and res["prediction_applicable"] is False


def test_prediction_absent_without_an_observable():
    res = lie_algebra(_free_fermion(3))
    assert res["purity"]["observable"] is None and res["predicted_variance"] is None


def test_trailing_clifford_conjugates_the_observable():
    b = Builder(3)
    for q in range(3):
        b.rot("RX", (q,))
    for q in range(2):
        b.rot("RZZ", (q, q + 1))
    plain = lie_algebra(b.build(), observable=parse_observable("Z0*Z1", 3))
    for q in range(3):
        b.add("H", (q,))
    moved = lie_algebra(b.build(), observable=parse_observable("X0*X1", 3))   # H Z0Z1 H... = X0X1 pulled back
    assert plain["purity"]["observable_in_algebra"] is True and moved["purity"]["observable_in_algebra"] is True
    assert moved["purity"]["observable"] == pytest.approx(plain["purity"]["observable"])
    assert moved["predicted_variance"] == pytest.approx(plain["predicted_variance"])


def test_sum_path_purities_match_wave1_reference_implementation():
    c = _qaoa_ring(4, 2)
    obs = parse_observable("preset:tfim", 4)
    res = lie_algebra(c, observable=obs)
    from kernel.trainability.lie import _conjugate_observable, _effective_clifford
    gens, frame = _effective_clifford(walk(c), 4)
    closure = lie_core.pauli_sum_closure([g for _, g in gens], n_qubits=4)
    ref = lie_core.g_purities_sum(closure, [(t.coeff, t.ops) for t in _terms(_conjugate_observable(obs, frame, 4))], 4)
    assert res["purity"]["observable"] == pytest.approx(ref["purity_observable"])
    assert res["purity"]["initial_state"] == pytest.approx(ref["purity_state"])
    assert res["purity"]["observable_in_algebra"] == ref["observable_in_algebra"]


def _terms(conj):
    return [PauliTerm(c, ops) for c, ops in conj]


def test_walk_expands_u_gate_in_time_order_and_classifies_fixed_gates():
    c = ParamCircuit(1, [IrGate("U", (0,), (ParamRef("a"), math.pi / 2, ParamRef("b"))), IrGate("T", (0,)),
                         IrGate("RX", (0,), (0.3,)), IrGate("RZ", (0,), (math.pi,)), IrGate("RY", (0,), (0.0,))],
                     ["a", "b"])
    items = walk(c)
    kinds = [type(i).__name__ for i in items]
    assert kinds == ["Rotation", "Rotation", "FixedClifford", "FixedOther", "FixedOther", "FixedClifford"]
    assert items[-1].names == ("S", "S") and items[2].names == ("S",)   # RZ(pi/2), RZ(pi); RY(0) is dropped
    rot = [i for i in items if isinstance(i, Rotation)]
    assert [r.ref.name for r in rot] == ["b", "a"]           # U = RZ(phi) RY(theta) RZ(lambda): lambda first
