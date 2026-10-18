"""Tests for kernel.trainability.symplectic (PRD 14 addendum §A)."""

from __future__ import annotations

import time

import numpy as np
import pytest

from kernel.trainability import symplectic as sy
from kernel.trainability._symplectic_gates import clifford_decomposition
from kernel.trainability.symplectic import (
    CliffordConjugator, PauliArray, PauliFrontier, anticommute_matrix, anticommutes,
    expectation_zero_state, is_clifford_gate, is_z_type, multiply, popcount, weight,
)

I2 = np.eye(2, dtype=complex)
MATS = {"I": I2, "X": np.array([[0, 1], [1, 0]], complex), "Y": np.array([[0, -1j], [1j, 0]]),
        "Z": np.diag([1, -1]).astype(complex)}
PHASES = [1, 1j, -1, -1j]


def dense(label: str) -> np.ndarray:
    """Dense matrix of a label such as '-iXZ' (leftmost char = qubit 0 = leftmost kron factor)."""
    pre = {"": 1, "i": 1j, "-": -1, "-i": -1j}
    body = label.lstrip("-i") if label[:1] in "-i" else label
    prefix = label[: len(label) - len(body)]
    mat = np.array([[1.0 + 0j]])
    for ch in body:
        mat = np.kron(mat, MATS[ch])
    return pre[prefix] * mat


def random_labels(rng, n, count, phases=True):
    out = []
    for _ in range(count):
        body = "".join(rng.choice(list("IXYZ"), n))
        out.append(["", "i", "-", "-i"][rng.integers(4) if phases else 0] + body)
    return out


def full_dense(gate: str, qubits, n):
    """Dense U for one Clifford gate on n qubits; qubit 0 is the leftmost kron factor."""
    from kernel.trainability._symplectic_gates import _GATE_MATRICES, canonical_name
    mat = _GATE_MATRICES[canonical_name(gate)]
    k = len(qubits)
    dim = 2 ** n
    u = np.zeros((dim, dim), complex)
    for col in range(dim):
        bits = [(col >> (n - 1 - q)) & 1 for q in range(n)]
        sub = 0
        for q in qubits:
            sub = sub * 2 + bits[q]
        for row_sub in range(2 ** k):
            amp = mat[row_sub, sub]
            if amp == 0:
                continue
            nb = list(bits)
            for t, q in enumerate(qubits):
                nb[q] = (row_sub >> (k - 1 - t)) & 1
            row = 0
            for b in nb:
                row = row * 2 + b
            u[row, col] += amp
    return u


@pytest.mark.parametrize("n", [1, 63, 64, 65, 128])
def test_label_and_sparse_round_trip(n):
    rng = np.random.default_rng(n)
    labels = random_labels(rng, n, 20)
    arr = PauliArray.from_labels(labels, n)
    assert arr.to_labels() == labels
    sparse = arr.to_sparse()
    rebuilt = PauliArray.from_sparse([ops for _, ops in sparse], n)
    rebuilt = rebuilt.with_phase(np.array([ph for ph, _ in sparse], dtype=np.uint8))
    assert rebuilt.to_labels() == labels
    assert arr.x.shape == (20, sy.n_words(n))


def test_n_words_and_qubit_layout():
    assert [sy.n_words(k) for k in (0, 1, 64, 65, 128, 129)] == [1, 1, 1, 2, 2, 3]
    p = PauliArray.from_sparse([((0, "X"), (64, "Z"), (65, "Y"))], 66)
    assert int(p.x[0, 0]) == 1 and int(p.z[0, 0]) == 0
    assert int(p.x[0, 1]) == 0b10 and int(p.z[0, 1]) == 0b11


def test_from_labels_rejects_garbage():
    with pytest.raises(ValueError):
        PauliArray.from_labels(["XQ"])


@pytest.mark.parametrize("n", [1, 2, 3, 5])
def test_multiply_matches_dense(n):
    rng = np.random.default_rng(10 + n)
    la, lb = random_labels(rng, n, 40), random_labels(rng, n, 40)
    prod = multiply(PauliArray.from_labels(la, n), PauliArray.from_labels(lb, n)).to_labels()
    for a, b, c in zip(la, lb, prod):
        np.testing.assert_allclose(dense(a) @ dense(b), dense(c), atol=1e-12)


def test_multiply_broadcast():
    a = PauliArray.from_labels(["XY"], 2)
    b = PauliArray.from_labels(["ZI", "IX", "YY"], 2)
    assert multiply(a, b).to_labels() == [multiply(a, b.take([i])).to_labels()[0] for i in range(3)]


def test_hermitian_y_not_xz():
    assert multiply(PauliArray.from_labels(["X"]), PauliArray.from_labels(["Z"])).to_labels() == ["-iY"]
    assert multiply(PauliArray.from_labels(["Z"]), PauliArray.from_labels(["X"])).to_labels() == ["iY"]


@pytest.mark.parametrize("n", [1, 3, 5])
def test_anticommutes_matches_dense(n):
    rng = np.random.default_rng(20 + n)
    la, lb = random_labels(rng, n, 15, False), random_labels(rng, n, 30, False)
    a, b = PauliArray.from_labels(la, n), PauliArray.from_labels(lb, n)
    mat = anticommute_matrix(a, b)
    for i, x in enumerate(la):
        row = anticommutes(a, i, b)
        for j, y in enumerate(lb):
            comm = dense(x) @ dense(y) - dense(y) @ dense(x)
            anti = dense(x) @ dense(y) + dense(y) @ dense(x)
            expected = np.allclose(anti, 0) and not np.allclose(comm, 0)
            assert bool(row[j]) == expected == bool(mat[i, j])


def test_anticommutes_multiword():
    a = PauliArray.from_sparse([((3, "X"), (100, "Z"))], 128)
    b = PauliArray.from_sparse([((3, "Z"), (100, "Z")), ((3, "Z"), (100, "X")), ((5, "X"),)], 128)
    assert list(anticommutes(a, 0, b)) == [True, False, False]


def test_popcount_and_weight():
    words = np.array([[0xFF, 1], [0, 0], [2 ** 64 - 1, 2 ** 64 - 1]], dtype=np.uint64)
    assert list(popcount(words)) == [9, 0, 128]
    assert list(weight(PauliArray.from_labels(["XIZY", "IIII"]))) == [3, 0]


def test_popcount_fallback_agrees(monkeypatch):
    words = np.random.default_rng(1).integers(0, 2 ** 63, (50, 3), dtype=np.uint64) * np.uint64(3)
    ref = popcount(words)
    monkeypatch.setattr(sy, "_HAS_BITWISE_COUNT", False)
    assert np.array_equal(popcount(words), ref)


def test_z_type_and_zero_state_expectation():
    p = PauliArray.from_labels(["ZZI", "-ZII", "XZI", "IYI", "iZZ"])
    assert list(is_z_type(p)) == [True, True, False, False, True]
    np.testing.assert_allclose(expectation_zero_state(p), [1, -1, 0, 0, 1j])


def test_commutator_string_is_product_for_anticommuting():
    a, b = PauliArray.from_labels(["XI"]), PauliArray.from_labels(["ZI"])
    c = sy.commutator_string(a, b)
    ha, hb = dense("XI"), dense("ZI")
    np.testing.assert_allclose((ha @ hb - hb @ ha) / 2, dense(c.to_labels()[0]), atol=1e-12)


GATES_1Q = ["H", "S", "SDG", "X", "Y", "Z", "SX", "SXDG", "I"]
GATES_2Q = ["CX", "CY", "CZ", "SWAP", "ISWAP"]


def random_clifford(rng, n, length):
    gates = []
    for _ in range(length):
        if n > 1 and rng.random() < 0.5:
            name = rng.choice(GATES_2Q)
            gates.append((str(name), tuple(int(q) for q in rng.choice(n, 2, replace=False))))
        else:
            gates.append((str(rng.choice(GATES_1Q)), (int(rng.integers(n)),)))
    return gates


def dense_unitary(gates, n):
    u = np.eye(2 ** n, dtype=complex)
    for name, qs in gates:
        u = full_dense(name, qs, n) @ u
    return u


@pytest.mark.parametrize("backend", [False, True])
@pytest.mark.parametrize("n", [1, 2, 3, 4])
def test_conjugator_matches_dense(n, backend):
    rng = np.random.default_rng(30 + n)
    for _ in range(6):
        gates = random_clifford(rng, n, 12)
        conj = CliffordConjugator(gates, n, use_stim=backend)
        assert conj.backend == ("stim" if backend else "native")
        labels = random_labels(rng, n, 25)
        out = conj.conjugate(PauliArray.from_labels(labels, n)).to_labels()
        u = dense_unitary(gates, n)
        for lab, res in zip(labels, out):
            np.testing.assert_allclose(u.conj().T @ dense(lab) @ u, dense(res), atol=1e-10)


def test_every_supported_gate_individually():
    for name in sorted(CliffordConjugator.SUPPORTED):
        qs = (0,) if name in GATES_1Q else (0, 1)
        n = 2
        labels = [a + b for a in "IXYZ" for b in "IXYZ"]
        out = CliffordConjugator([(name, qs)], n, use_stim=False).conjugate(PauliArray.from_labels(labels, n))
        u = full_dense(name, qs, n)
        for lab, res in zip(labels, out.to_labels()):
            np.testing.assert_allclose(u.conj().T @ dense(lab) @ u, dense(res), atol=1e-10)


def test_native_equals_stim_n70():
    n = 70
    rng = np.random.default_rng(5)
    gates = random_clifford(rng, n, 400)
    labels = random_labels(rng, n, 60)
    arr = PauliArray.from_labels(labels, n)
    nat = CliffordConjugator(gates, n, use_stim=False).conjugate(arr)
    stm = CliffordConjugator(gates, n, use_stim=True).conjugate(arr)
    assert nat.to_labels() == stm.to_labels()


def test_native_equals_stim_pauli_after():
    stim = pytest.importorskip("stim")
    n = 70
    rng = np.random.default_rng(6)
    gates = random_clifford(rng, n, 200)
    circ = stim.Circuit()
    circ.append("I", [n - 1])
    from kernel.trainability._symplectic_gates import STIM_NAMES, canonical_name
    for name, qs in gates:
        circ.append(STIM_NAMES[canonical_name(name)], list(qs))
    labels = random_labels(rng, n, 10, phases=False)
    out = CliffordConjugator(gates, n, use_stim=False).conjugate(PauliArray.from_labels(labels, n)).to_labels()
    # stim: tableau(P) = U P U^dag, so U^dag P U = inverse tableau
    inv = stim.Tableau.from_circuit(circ).inverse()
    for lab, res in zip(labels, out):
        ref = inv(stim.PauliString(lab))
        s = "+" if ref.sign == 1 else "-"
        assert res == ("-" if s == "-" else "") + str(ref)[1:].replace("_", "I")


def test_auto_backend_and_errors():
    assert CliffordConjugator([("H", (0,))], 4).backend == "native"
    many = [("H", (i % 4,)) for i in range(40)]
    assert CliffordConjugator(many, 4).backend == "stim"
    with pytest.raises(ValueError):
        CliffordConjugator([("CX", (0, 0))], 2)
    with pytest.raises(ValueError):
        CliffordConjugator([("T", (0,))], 2)
    assert CliffordConjugator([("cnot", (0, 1))], 2).gates == [("CX", (0, 1))]


def test_is_clifford_gate():
    assert is_clifford_gate("H") and is_clifford_gate("CZ") and is_clifford_gate("sdg")
    assert not is_clifford_gate("T") and not is_clifford_gate("RZ", (0.3,))
    assert is_clifford_gate("RZ", (np.pi / 2,)) and is_clifford_gate("RX", (np.pi,))
    assert is_clifford_gate("RY", (-np.pi / 2,)) and is_clifford_gate("P", (np.pi,))


@pytest.mark.parametrize("name,angle", [("RZ", 1), ("RZ", 3), ("RX", 1), ("RX", 2), ("RY", 1), ("RY", 2), ("RY", 3),
                                        ("P", 2), ("RZ", -1)])
def test_clifford_decomposition_matches_rotation(name, angle):
    theta = angle * np.pi / 2
    gens = {"RZ": "Z", "RX": "X", "RY": "Y", "P": "Z"}
    pm = MATS[gens[name]]
    if name == "P":
        rot = np.diag([1, np.exp(1j * theta)])
    else:
        rot = np.cos(theta / 2) * I2 - 1j * np.sin(theta / 2) * pm
    seq = clifford_decomposition(name, (theta,))
    u = np.eye(2, dtype=complex)
    for g in seq:
        u = full_dense(g, (0,), 1) @ u
    ov = np.trace(u.conj().T @ rot) / 2
    assert abs(abs(ov) - 1) < 1e-9


def test_frontier_merge_and_prune_accounting():
    p = PauliArray.from_labels(["XI", "XI", "-XI", "ZZ", "IY"], 2)
    fr = PauliFrontier.from_array(p, np.array([0.5, 0.25, 0.125, 1e-14, -2.0]))
    assert len(fr) == 3
    arr, w = fr.to_array()
    got = dict(zip(arr.to_labels(), w))
    assert got["XI"] == pytest.approx(0.625) and got["ZZ"] == pytest.approx(1e-14) and got["IY"] == -2.0
    lost = fr.prune(max_weight=None, min_abs=1e-12)
    assert lost == pytest.approx(1e-14) and len(fr) == 2
    lost2 = fr.prune(max_weight=1, min_abs=0.0)
    assert lost2 == pytest.approx(0.0) or lost2 >= 0
    fr2 = PauliFrontier.from_array(PauliArray.from_labels(["XX", "XI", "IZ"], 2), np.array([3.0, -1.0, 0.5]))
    assert fr2.prune(max_weight=1, min_abs=0.0) == pytest.approx(3.0)
    assert fr2.discarded == pytest.approx(3.0) and len(fr2) == 2


def test_frontier_rejects_non_hermitian():
    with pytest.raises(ValueError):
        PauliFrontier.from_array(PauliArray.from_labels(["iX"]), np.array([1.0]))


def test_frontier_multiword_merge():
    labels = ["X" + "I" * 99 + "Z"] * 3
    fr = PauliFrontier.from_array(PauliArray.from_labels(labels, 101), np.array([1.0, 2.0, 3.0]))
    assert len(fr) == 1 and fr.to_array()[1][0] == 6.0


def test_commutation_speed_one_vs_million_n128():
    n, count = 128, 1_000_000
    rng = np.random.default_rng(0)
    big = PauliArray(n, rng.integers(0, 2 ** 63, (count, 2), dtype=np.uint64),
                     rng.integers(0, 2 ** 63, (count, 2), dtype=np.uint64), np.zeros(count, np.uint8))
    one = PauliArray.from_sparse([((0, "X"), (70, "Z"), (127, "Y"))], n)
    anticommutes(one, 0, big)  # warm-up
    t0 = time.perf_counter()
    res = anticommutes(one, 0, big)
    dt = time.perf_counter() - t0
    assert res.shape == (count,)
    assert dt < 0.5, f"commutation took {dt:.3f}s"
