"""Tests for the Pauli Propagation Engine core (kernel.trainability.ppe_core)."""

from __future__ import annotations

import itertools
import time

import numpy as np
import pytest

from kernel.tests.test_trainability_symplectic import GATES_1Q, GATES_2Q, MATS, full_dense
from kernel.trainability.ppe_core import (
    CliffordGate, PauliRotation, expectation_bounds, frontier_curve, gradient_variances,
)

LETTERS = "XYZ"


# ---------------------------------------------------------------- dense reference
def pauli_dense(ops, n):
    mat = np.array([[1.0 + 0j]])
    letters = dict(ops)
    for q in range(n):
        mat = np.kron(mat, MATS[letters.get(q, "I")])
    return mat


def obs_dense(observable, n):
    return sum(c * pauli_dense(ops, n) for c, ops in observable)


class Dense:
    """Brute-force statevector evaluator of C(theta) = <0|U^dag O U|0> for a rotation program."""

    def __init__(self, program, n, observable):
        self.n, self.program = n, list(program)
        self.o = obs_dense(observable, n)
        self.cliff = {id(g): full_dense(g.name, g.qubits, n) for g in self.program if isinstance(g, CliffordGate)}
        self.paulis = {}
        for g in self.program:
            if isinstance(g, PauliRotation):
                dense_p = pauli_dense(g.ops, n)
                xmask = sum(1 << (n - 1 - q) for q, c in g.ops if c in "XY")
                rows = np.arange(2 ** n)
                self.paulis[id(g)] = (rows ^ xmask, dense_p[rows, rows ^ xmask])  # (Pψ)[y] = ph[y] ψ[y^xmask]

    def cost(self, thetas: np.ndarray) -> np.ndarray:
        thetas = np.atleast_2d(thetas)
        psi = np.zeros((thetas.shape[0], 2 ** self.n), complex)
        psi[:, 0] = 1
        for g in self.program:
            if isinstance(g, CliffordGate):
                psi = psi @ self.cliff[id(g)].T
            else:
                half = g.freq * thetas[:, g.param] / 2
                src, ph = self.paulis[id(g)]
                p_psi = ph[None, :] * psi[:, src]
                psi = np.cos(half)[:, None] * psi - 1j * np.sin(half)[:, None] * p_psi
        return np.einsum("bi,ij,bj->b", psi.conj(), self.o, psi).real

    def grad(self, thetas, k, freq):
        s = np.pi / (2 * freq)
        up, dn = thetas.copy(), thetas.copy()
        up[:, k] += s
        dn[:, k] -= s
        return freq / 2 * (self.cost(up) - self.cost(dn))

    def exact_grad_variances(self, n_params, freqs):
        """Exact average over a product grid (trig polynomials are integrated exactly)."""
        sizes = [2 * abs(freqs[k]) + 1 for k in range(n_params)]
        axes = [2 * np.pi * np.arange(m) / m + 0.123 * (i + 1) for i, m in enumerate(sizes)]
        grid = np.array(list(itertools.product(*axes)))
        return [float(np.mean(self.grad(grid, k, freqs[k]) ** 2)) for k in range(n_params)]


def random_program(rng, n, n_rot, max_w=3, p_cliff=0.4, freqs=None, global_prob=0.0):
    prog, freq_of = [], {}
    for k in range(n_rot):
        while rng.random() < p_cliff:
            if n > 1 and rng.random() < 0.5:
                prog.append(CliffordGate(str(rng.choice(GATES_2Q)), tuple(int(q) for q in rng.choice(n, 2, replace=False))))
            else:
                prog.append(CliffordGate(str(rng.choice(GATES_1Q)), (int(rng.integers(n)),)))
        if rng.random() < global_prob:
            qs = list(range(n))
        else:
            qs = sorted(int(q) for q in rng.choice(n, int(rng.integers(1, min(n, max_w) + 1)), replace=False))
        f = 1 if freqs is None else int(freqs[k % len(freqs)])
        freq_of[k] = f
        prog.append(PauliRotation(tuple((q, str(rng.choice(list(LETTERS)))) for q in qs), k, f))
    return prog, freq_of


def rand_obs(rng, n, kind):
    if kind == "local":
        return [(1.0, ((int(rng.integers(n)), "Z"),))]
    if kind == "global":
        return [(1.0, tuple((q, "Z") for q in range(n)))]
    terms = []
    for _ in range(4):
        qs = sorted(int(q) for q in rng.choice(n, int(rng.integers(1, min(n, 3) + 1)), replace=False))
        terms.append((float(rng.normal()), tuple((q, str(rng.choice(list(LETTERS)))) for q in qs)))
    terms.append((0.7, ((0, "Z"),)))
    terms.append((0.3, ()))
    return terms


# ---------------------------------------------------------------- closed forms
@pytest.mark.parametrize("f", [1, 2, 3, -2])
def test_single_anticommuting_rotation_closed_form(f):
    prog = [PauliRotation(((0, "X"),), 0, f)]
    res = gradient_variances(prog, 1, 1, [(1.0, ((0, "Z"),))])
    assert res["per_parameter"][0]["variance"] == pytest.approx(0.5 * f * f)
    assert res["method"] == "pauli_propagation_exact" and res["status"] == "complete"
    assert res["per_parameter"][0]["interval"] == pytest.approx([0.5 * f * f] * 2)


def test_commuting_rotation_is_dead_and_exactly_zero():
    prog = [PauliRotation(((0, "Z"),), 0, 1)]
    res = gradient_variances(prog, 1, 1, [(1.0, ((0, "Z"),))])
    row = res["per_parameter"][0]
    assert row["variance"] == 0.0 and row["interval"] == [0.0, 0.0] and row["dead"]


def test_sign_convention_i_pq():
    """Q -> cos(phi) Q + sin(phi) (i P Q): <0|.|0> for P=X, Q=Y is -sin(phi) ... checked against dense."""
    n = 1
    obs = [(1.0, ((0, "Y"),))]
    prog = [CliffordGate("H", (0,)), PauliRotation(((0, "X"),), 0, 1)]
    for th in (0.3, 1.1, 2.9):
        vals = np.array([th])
        got = expectation_bounds(prog, n, obs, vals)["value"]
        assert got == pytest.approx(Dense(prog, n, obs).cost(vals)[0], abs=1e-12)
    prog2 = [PauliRotation(((0, "X"),), 0, 1)]
    for th in (0.4, 2.0):
        got = expectation_bounds(prog2, n, [(1.0, ((0, "Z"),))], np.array([th]))["value"]
        assert got == pytest.approx(np.cos(th), abs=1e-12)
        got = expectation_bounds(prog2, n, [(1.0, ((0, "Y"),))], np.array([th]))["value"]
        assert got == pytest.approx(np.sin(th) * 0 + Dense(prog2, n, [(1.0, ((0, "Y"),))]).cost(np.array([th]))[0], abs=1e-12)


# ---------------------------------------------------------------- exact agreement
@pytest.mark.parametrize("seed", range(6))
@pytest.mark.parametrize("kind", ["local", "global", "sum"])
def test_matches_exact_grid_integration(seed, kind):
    rng = np.random.default_rng(100 * seed + len(kind))
    n = int(rng.integers(2, 5))
    n_rot = 5
    prog, freq_of = random_program(rng, n, n_rot, freqs=[1, 1, 2, 1, -1] if seed % 2 else None, global_prob=0.2)
    obs = rand_obs(rng, n, kind)
    res = gradient_variances(prog, n, n_rot, obs)
    ref = Dense(prog, n, obs).exact_grad_variances(n_rot, freq_of)
    for k in range(n_rot):
        assert res["per_parameter"][k]["variance"] == pytest.approx(ref[k], abs=1e-10), (k, prog)
    assert res["method"] == "pauli_propagation_exact"
    assert res["variance_mean"] == pytest.approx(np.mean(ref), abs=1e-10)


@pytest.mark.parametrize("seed,kind", [(0, "local"), (1, "global"), (2, "sum"), (3, "sum"), (4, "local")])
def test_matches_monte_carlo_99ci(seed, kind):
    rng = np.random.default_rng(900 + seed)
    n, n_rot, samples = (7 if seed == 4 else 6), 12, 6000
    prog, freq_of = random_program(rng, n, n_rot, global_prob=0.15)
    obs = rand_obs(rng, n, kind)
    res = gradient_variances(prog, n, n_rot, obs)
    dense = Dense(prog, n, obs)
    thetas = rng.uniform(0, 2 * np.pi, (samples, n_rot))
    for k in range(n_rot):
        g2 = dense.grad(thetas, k, 1) ** 2
        mean, se = g2.mean(), g2.std(ddof=1) / np.sqrt(samples)
        assert abs(res["per_parameter"][k]["variance"] - mean) <= 2.576 * se + 1e-12, (k, mean, se)


def test_expectation_bounds_matches_dense_when_untruncated():
    for seed in range(8):
        rng = np.random.default_rng(300 + seed)
        n = int(rng.integers(2, 6))
        prog, freq_of = random_program(rng, n, 7, freqs=[1, 2, -1, 3], global_prob=0.2)
        obs = rand_obs(rng, n, ["local", "global", "sum"][seed % 3])
        vals = rng.uniform(0, 2 * np.pi, 7)
        res = expectation_bounds(prog, n, obs, vals)
        want = Dense(prog, n, obs).cost(vals)[0]
        assert res["value"] == pytest.approx(want, abs=1e-10)
        assert res["method"] == "pauli_propagation_exact"
        assert res["interval"][0] - 1e-10 <= want <= res["interval"][1] + 1e-10
        assert res["interval"][1] - res["interval"][0] == pytest.approx(0, abs=1e-12)


# ---------------------------------------------------------------- truncation
@pytest.mark.parametrize("kind", ["local", "sum"])
@pytest.mark.parametrize("budget", [{"max_weight": 1}, {"max_weight": 2}, {"max_frontier": 3}, {"min_weight_abs": 0.2}])
def test_truncated_variance_interval_contains_exact(kind, budget):
    for seed in range(4):
        rng = np.random.default_rng(500 + seed)
        n, n_rot = 4, 6
        prog, freq_of = random_program(rng, n, n_rot, global_prob=0.3, freqs=[1, 2])
        obs = rand_obs(rng, n, kind)
        exact = Dense(prog, n, obs).exact_grad_variances(n_rot, freq_of)
        res = gradient_variances(prog, n, n_rot, obs, **budget)
        for k in range(n_rot):
            lo, hi = res["per_parameter"][k]["interval"]
            assert lo - 1e-10 <= exact[k] <= hi + 1e-10, (budget, k, lo, exact[k], hi)
        lo, hi = res["variance_mean_interval"]
        assert lo - 1e-10 <= np.mean(exact) <= hi + 1e-10


def test_truncation_reports_bounded_and_discarded_mass():
    rng = np.random.default_rng(7)
    prog, _ = random_program(rng, 5, 8, global_prob=0.3)
    res = gradient_variances(prog, 5, 8, [(1.0, tuple((q, "Z") for q in range(5)))], max_weight=1)
    if res["discarded_mass"] > 0:
        assert res["method"] == "pauli_propagation_bounded"


@pytest.mark.parametrize("budget", [{"max_weight": 1}, {"max_frontier": 4}, {"min_weight_abs": 0.1}])
def test_expectation_interval_contains_dense_when_truncated(budget):
    for seed in range(6):
        rng = np.random.default_rng(700 + seed)
        n = 5
        prog, _ = random_program(rng, n, 9, global_prob=0.3)
        obs = rand_obs(rng, n, ["local", "sum", "global"][seed % 3])
        vals = rng.uniform(0, 2 * np.pi, 9)
        res = expectation_bounds(prog, n, obs, vals, **budget)
        want = Dense(prog, n, obs).cost(vals)[0]
        assert res["interval"][0] - 1e-10 <= want <= res["interval"][1] + 1e-10, (budget, res, want)


def test_expired_time_budget_and_cancel_keep_valid_intervals():
    rng = np.random.default_rng(11)
    n, n_rot = 4, 6
    prog, freq_of = random_program(rng, n, n_rot, global_prob=0.3)
    obs = rand_obs(rng, n, "sum")
    exact = Dense(prog, n, obs).exact_grad_variances(n_rot, freq_of)
    for kwargs, status in (({"time_budget_s": 0.0}, "budget_exhausted"), ({"cancel": lambda: True}, "cancelled")):
        res = gradient_variances(prog, n, n_rot, obs, **kwargs)
        assert res["status"] == status and res["method"] == "pauli_propagation_bounded"
        for k in range(n_rot):
            lo, hi = res["per_parameter"][k]["interval"]
            assert lo - 1e-10 <= exact[k] <= hi + 1e-10
    vals = rng.uniform(0, 2 * np.pi, n_rot)
    r = expectation_bounds(prog, n, obs, vals, time_budget_s=0.0)
    want = Dense(prog, n, obs).cost(vals)[0]
    assert r["interval"][0] - 1e-10 <= want <= r["interval"][1] + 1e-10


# ---------------------------------------------------------------- light cone / structure
def test_light_cone_dead_parameters_exactly_zero():
    n = 6
    prog = [PauliRotation(((0, "Y"),), 0), PauliRotation(((4, "X"),), 1), CliffordGate("CX", (0, 1)),
            PauliRotation(((1, "Y"),), 2), PauliRotation(((5, "Y"), (4, "Z")), 3)]
    prog = [prog[0], prog[1], prog[2], prog[3], PauliRotation(((4, "Y"), (5, "Z")), 3)]
    res = gradient_variances(prog, n, 4, [(1.0, ((1, "Z"),))])
    rows = res["per_parameter"]
    assert rows[1]["variance"] == 0.0 and rows[1]["dead"] and rows[1]["dead_reason"] == "light_cone"
    assert rows[3]["variance"] == 0.0 and rows[3]["dead"]
    assert not rows[0]["dead"] and rows[0]["variance"] > 0
    assert res["method"] == "pauli_propagation_exact"


def test_unused_parameter_and_shared_parameter():
    res = gradient_variances([PauliRotation(((0, "X"),), 0)], 1, 2, [(1.0, ((0, "Z"),))])
    assert res["per_parameter"][1]["dead"] and res["per_parameter"][1]["variance"] == 0.0
    with pytest.raises(ValueError):
        gradient_variances([PauliRotation(((0, "X"),), 0), PauliRotation(((0, "Y"),), 0)], 1, 1, [(1.0, ((0, "Z"),))])
    with pytest.raises(ValueError):
        gradient_variances([PauliRotation(((0, "X"),), 0, 0)], 1, 1, [(1.0, ((0, "Z"),))])


def test_single_pauli_chain_conserves_mass():
    """Diagonal chain: with an observable that keeps anticommuting everywhere the mass is preserved."""
    prog = [PauliRotation(((0, "X"),), 0), PauliRotation(((0, "Y"),), 1)]
    res = gradient_variances(prog, 1, 2, [(2.0, ((0, "Z"),))])
    v = [r["variance"] for r in res["per_parameter"]]
    # C = 2 cos(th1)... param1 acts first (index order = time order): O -> Y-rot then X-rot
    ref = Dense(prog, 1, [(2.0, ((0, "Z"),))]).exact_grad_variances(2, {0: 1, 1: 1})
    assert v == pytest.approx(ref)


def hea(n, layers):
    prog, k = [], 0
    for _ in range(layers):
        for q in range(n):
            prog.append(PauliRotation(((q, "Y"),), k))
            k += 1
        for q in range(n - 1):
            prog.append(CliffordGate("CZ", (q, q + 1)))
    return prog, k


def test_global_z_hea_variance_decays_with_n():
    means = []
    for n in range(2, 11):
        prog, n_par = hea(n, 3)
        res = gradient_variances(prog, n, n_par, [(1.0, tuple((q, "Z") for q in range(n)))])
        assert res["method"] == "pauli_propagation_exact"
        means.append(res["variance_mean"])
    assert all(b < a for a, b in zip(means, means[1:])), means
    assert means[-1] < 0.1 * means[1]


def test_hea_matches_dense_small():
    prog, n_par = hea(3, 2)
    obs = [(1.0, ((0, "Z"), (1, "Z"), (2, "Z")))]
    res = gradient_variances(prog, 3, n_par, obs)
    ref = Dense(prog, 3, obs).exact_grad_variances(n_par, {k: 1 for k in range(n_par)})
    assert [r["variance"] for r in res["per_parameter"]] == pytest.approx(ref, abs=1e-10)


def test_frontier_curve_intervals_contain_value_and_shrink():
    rng = np.random.default_rng(21)
    n = 5
    prog, _ = random_program(rng, n, 10, global_prob=0.3)
    obs = rand_obs(rng, n, "sum")
    vals = rng.uniform(0, 2 * np.pi, 10)
    want = Dense(prog, n, obs).cost(vals)[0]
    curve = frontier_curve(prog, n, obs, vals, frontier_sizes=[2, 8, 32, 10 ** 6])
    assert [c["max_frontier"] for c in curve] == [2, 8, 32, 10 ** 6]
    for c in curve:
        assert c["interval"][0] - 1e-10 <= want <= c["interval"][1] + 1e-10
    assert curve[-1]["width"] == pytest.approx(0, abs=1e-12)
    assert curve[0]["width"] >= curve[-1]["width"]


# ---------------------------------------------------------------- scale
def shallow_local(n, layers):
    prog, k = [], 0
    for layer in range(layers):
        for q in range(n):
            prog.append(PauliRotation(((q, "Y"),), k))
            k += 1
        for q in range(layer % 2, n - 1, 2):
            prog.append(CliffordGate("CZ", (q, q + 1)))
    return prog, k


@pytest.mark.parametrize("n", [64, 128])
def test_large_n_shallow_local_observable_within_budget(n, record_property):
    prog, n_par = shallow_local(n, 4)
    obs = [(1.0, ((0, "Z"), (1, "Z")))]
    t0 = time.perf_counter()
    res = gradient_variances(prog, n, n_par, obs, time_budget_s=20.0)
    dt = time.perf_counter() - t0
    record_property("seconds", round(dt, 3))
    print(f"\nPPE n={n} params={n_par}: {dt:.2f}s peak={res['frontier_peak']} mean_var={res['variance_mean']:.3e}")
    assert res["status"] == "complete" and res["method"] == "pauli_propagation_exact"
    assert dt < 20.0
    dead = sum(r["dead"] for r in res["per_parameter"])
    assert dead > 0.5 * n_par  # the backward light cone of Z0Z1 is narrow
