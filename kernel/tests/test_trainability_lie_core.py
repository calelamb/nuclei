"""Tests for kernel.trainability.lie_core (dynamical Lie algebra closure)."""

from __future__ import annotations

import time

import numpy as np
import pytest

from kernel.tests.test_trainability_symplectic import MATS
from kernel.trainability.lie_core import (
    classify_dimension, dense_closure, g_purities, g_purities_sum, pauli_string_closure, pauli_sum_closure,
    predicted_variance,
)
from kernel.trainability.symplectic import CliffordConjugator, PauliArray


def pauli_dense(ops, n):
    letters = dict(ops)
    mat = np.array([[1.0 + 0j]])
    for q in range(n):
        mat = np.kron(mat, MATS[letters.get(q, "I")])
    return mat


def sparse_gens(items, n):
    return PauliArray.from_sparse(items, n)


def tfim_gens(n):
    return [((i, "X"),) for i in range(n)] + [((i, "Z"), (i + 1, "Z")) for i in range(n - 1)]


@pytest.mark.parametrize("n", [2, 3, 4, 5, 6])
def test_free_fermion_dimension(n):
    res = pauli_string_closure(sparse_gens(tfim_gens(n), n))
    assert res["status"] == "complete"
    assert res["dimension"] == n * (2 * n - 1)
    assert classify_dimension(res["dimension"], n)["family"] in {"free_fermion", "so", "sp"}


def test_xy_plus_zz_chain_n3_is_63():
    items = [((i, c),) for i in range(3) for c in "XY"] + [((i, "Z"), (i + 1, "Z")) for i in range(2)]
    res = pauli_string_closure(sparse_gens(items, 3))
    assert res["dimension"] == 63
    assert classify_dimension(63, 3)["label"] == "su(8)"


def test_single_z_is_abelian_dimension_one():
    res = pauli_string_closure(sparse_gens([((0, "Z"),)], 3))
    assert res["dimension"] == 1 and res["status"] == "complete"
    assert classify_dimension(1, 3)["label"] == "other"


def test_identity_and_duplicate_generators_ignored():
    res = pauli_string_closure(PauliArray.from_labels(["II", "ZI", "-ZI", "iZI"], 2))
    assert res["dimension"] == 1


def effective_hea_generators(n, layers, brickwork):
    """Effective generators G~_k = V_k^dag Y_q V_k of RY layers each followed by a CZ layer."""
    gens, prefix = [], []
    for layer in range(layers):
        conj = CliffordConjugator(prefix, n)
        ys = PauliArray.from_sparse([((q, "Y"),) for q in range(n)], n)
        gens.append(conj.conjugate(ys))
        bonds = range(layer % 2, n - 1, 2) if brickwork else range(n - 1)
        prefix = prefix + [("CZ", (q, q + 1)) for q in bonds]
    return PauliArray.concat(gens)


def test_hea_ry_cz_brickwork_n3_is_28():
    res = pauli_string_closure(effective_hea_generators(3, 4, brickwork=True))
    assert res["dimension"] == 28
    assert classify_dimension(28, 3)["label"] == "so(8)"


def test_repeated_full_cz_ladder_collapses_because_ladder_is_an_involution():
    # CZ layers commute and square to the identity, so only two distinct effective generator sets exist.
    assert pauli_string_closure(effective_hea_generators(3, 4, brickwork=False))["dimension"] == 12


def test_dimension_cap_truncates_with_lower_bound():
    res = pauli_string_closure(sparse_gens(tfim_gens(6), 6), max_dimension=20)
    assert res["status"] == "truncated" and res["dimension_lower_bound"] == res["dimension"] <= 20
    assert res["reason"] == "max_dimension"


def test_time_budget_and_cancel():
    gens = sparse_gens(tfim_gens(6), 6)
    assert pauli_string_closure(gens, time_budget_s=0.0)["status"] == "truncated"
    assert pauli_string_closure(gens, cancel=lambda: True)["reason"] == "cancelled"


@pytest.mark.parametrize("seed", range(8))
def test_string_closure_matches_dense_random_sets(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(2, 5))
    labels = ["".join(rng.choice(list("IXYZ"), n)) for _ in range(int(rng.integers(2, 6)))]
    arr = PauliArray.from_labels(labels, n)
    mats = [pauli_dense([(q, c) for q, c in enumerate(lab) if c != "I"], n) for lab in labels if set(lab) != {"I"}]
    assert pauli_string_closure(arr)["dimension"] == dense_closure(mats)


def qaoa_ring_sums(n):
    zz = {tuple(sorted(((i, "Z"), ((i + 1) % n, "Z")))): 1.0 for i in range(n)}
    xs = {((i, "X"),): 1.0 for i in range(n)}
    return zz, xs


def test_sum_closure_qaoa_ring_matches_dense_n4():
    n = 4
    zz, xs = qaoa_ring_sums(n)
    res = pauli_sum_closure([zz, xs], n_qubits=n)
    dense = dense_closure([sum(c * pauli_dense(k, n) for k, c in zz.items()),
                           sum(c * pauli_dense(k, n) for k, c in xs.items())])
    assert res["status"] == "complete"
    assert res["dimension"] == dense and dense > 2


def test_sum_closure_equals_string_closure_for_single_strings():
    n = 3
    gens = [{ops: 1.0} for ops in tfim_gens(n)]
    assert pauli_sum_closure(gens, n_qubits=n)["dimension"] == pauli_string_closure(sparse_gens(tfim_gens(n), n))["dimension"]


def test_sum_closure_rejects_non_hermitian_and_respects_cap():
    with pytest.raises(ValueError):
        pauli_sum_closure([{((0, "Z"),): 1j}], n_qubits=1)
    zz, xs = qaoa_ring_sums(4)
    res = pauli_sum_closure([zz, xs], n_qubits=4, max_dimension=3)
    assert res["status"] == "truncated" and res["dimension"] <= 3


def test_dense_closure_known_values():
    x, z = MATS["X"], MATS["Z"]
    assert dense_closure([x, z]) == 3                       # su(2)
    assert dense_closure([z]) == 1
    assert dense_closure([np.kron(z, z), np.kron(x, np.eye(2)), np.kron(np.eye(2), x)]) == 6


def test_classify_dimension_table():
    assert classify_dimension(15, 2)["label"] == "su(4)"
    assert classify_dimension(6, 2)["candidates"][0]["label"] == "so(4)"
    assert classify_dimension(10, 2)["label"] == "sp(2)"
    c = classify_dimension(45, 5)
    assert c["family"] == "free_fermion" and c["label"] == "so(10)" and "not an isomorphism proof" in c["note"]
    assert classify_dimension(7, 3)["label"] == "other"


def test_purity_formulas_single_string_observable():
    n = 3
    res = pauli_string_closure(sparse_gens(tfim_gens(n), n))
    pur = g_purities(res["basis"], [(1.0, ((0, "Z"), (1, "Z")))], n)
    assert pur["observable_in_algebra"] and not pur["state_in_algebra"]
    assert pur["purity_observable"] == pytest.approx(2 ** n)
    z_strings = [s for s in res["basis"].to_labels() if set(s) <= {"I", "Z"}]
    assert pur["purity_state"] == pytest.approx(len(z_strings) / 2 ** n)
    assert predicted_variance(pur, res["dimension"]) == pytest.approx(pur["purity_state"] * 2 ** n / res["dimension"])
    out = g_purities(res["basis"], [(1.0, ((0, "Y"),))], n)
    assert not out["observable_in_algebra"] and predicted_variance(out, res["dimension"]) is None


def test_sum_purities_agree_with_string_path():
    n = 3
    items = tfim_gens(n)
    strings = pauli_string_closure(sparse_gens(items, n))
    sums = pauli_sum_closure([{ops: 1.0} for ops in items], n_qubits=n)
    obs = [(0.5, ((0, "Z"), (1, "Z"))), (0.25, ((1, "Z"), (2, "Z")))]
    a, b = g_purities(strings["basis"], obs, n), g_purities_sum(sums, obs, n)
    assert b["purity_observable"] == pytest.approx(a["purity_observable"])
    assert b["purity_state"] == pytest.approx(a["purity_state"])
    assert b["observable_in_algebra"] and a["observable_in_algebra"]


def test_predicted_variance_matches_monte_carlo_free_fermion_n4():
    n, layers, samples = 4, 30, 3000
    items = tfim_gens(n)
    res = pauli_string_closure(sparse_gens(items, n))
    obs = [(1.0, ((0, "Z"), (1, "Z")))]
    pred = predicted_variance(g_purities(res["basis"], obs, n), res["dimension"])
    assert pred is not None
    rng = np.random.default_rng(3)
    mats = [pauli_dense(ops, n) for ops in items]
    o = pauli_dense(obs[0][1], n)
    psi = np.zeros((samples, 2 ** n), complex)
    psi[:, 0] = 1
    for _ in range(layers):
        for g in mats:
            th = rng.uniform(0, 2 * np.pi, samples)
            psi = np.cos(th)[:, None] * psi - 1j * np.sin(th)[:, None] * (psi @ g.T)
    vals = np.einsum("bi,ij,bj->b", psi.conj(), o, psi).real
    assert vals.var() == pytest.approx(pred, rel=0.15), (vals.var(), pred)


def test_large_closure_timing(capsys):
    """Large closure at n=6 (dimension up to 4095), time reported."""
    n = 6
    items = tfim_gens(n) + [((0, "Z"),), ((0, "Y"), (1, "Y"), (2, "X"))]
    t0 = time.perf_counter()
    res = pauli_string_closure(sparse_gens(items, n), max_dimension=5000)
    dt = time.perf_counter() - t0
    print(f"\nclosure dim={res['dimension']} n={n} in {dt:.2f}s")
    assert res["status"] == "complete" and res["dimension"] <= 4095
    assert dt < 30


def test_closure_at_1e4_scale_n7(capsys):
    """su(2^7) has dimension 16383 (> 10^4): reported time."""
    n = 7
    items = tfim_gens(n) + [((0, "Z"),), ((0, "Y"), (1, "Y"), (2, "X"))]
    t0 = time.perf_counter()
    res = pauli_string_closure(sparse_gens(items, n), max_dimension=20000)
    dt = time.perf_counter() - t0
    print(f"\nclosure dim={res['dimension']} n={n} in {dt:.2f}s")
    assert res["status"] == "complete" and res["dimension"] == 4 ** n - 1
    assert dt < 10
