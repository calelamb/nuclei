"""Observable grammar, merging, Hermiticity and fast Pauli application."""

import numpy as np
import pytest

from kernel.trainability.pauli import (
    ObservableError,
    PauliTerm,
    apply_pauli_term,
    parse_observable,
    pauli_sum_matrix,
)

X = np.array([[0, 1], [1, 0]], dtype=complex)
Y = np.array([[0, -1j], [1j, 0]])
Z = np.diag([1.0, -1.0]).astype(complex)
I2 = np.eye(2, dtype=complex)


def dense(ops, n):
    """Independent kron-based dense Pauli (little-endian: qubit n-1 leftmost)."""
    mats = {q: m for q, m in ops}
    out = np.eye(1, dtype=complex)
    for q in reversed(range(n)):
        out = np.kron(out, mats.get(q, I2))
    return out


def test_simple_terms_and_text_roundtrip():
    ps = parse_observable("0.5*Z0*Z1 + X2", 3)
    assert ps.terms == (PauliTerm(0.5, ((0, "Z"), (1, "Z"))), PauliTerm(1.0, ((2, "X"),)))
    assert ps.to_text() == "0.5*Z0*Z1 + X2"
    assert parse_observable(ps.to_text(), 3) == ps
    assert ps.max_qubit() == 2 and ps.weight() == 2


@pytest.mark.parametrize(
    "spec,expected",
    [
        ("Z0Z1", [(1.0, ((0, "Z"), (1, "Z")))]),
        ("Z0 Z1", [(1.0, ((0, "Z"), (1, "Z")))]),
        ("Z0*Z1", [(1.0, ((0, "Z"), (1, "Z")))]),
        ("2 Z0", [(2.0, ((0, "Z"),))]),
        ("1e-3 X1", [(1e-3, ((1, "X"),))]),
        ("1e-3*X1", [(1e-3, ((1, "X"),))]),
        ("-Z0 - 2.5*X1", [(-1.0, ((0, "Z"),)), (-2.5, ((1, "X"),))]),
        ("z0 + y1", [(1.0, ((0, "Z"),)), (1.0, ((1, "Y"),))]),
        (".5Z0", [(0.5, ((0, "Z"),))]),
        ("3", [(3.0, ())]),
    ],
)
def test_valid_grammar(spec, expected):
    ps = parse_observable(spec, 4)
    assert [(t.coeff, t.ops) for t in ps.terms] == expected


def test_like_terms_merge_and_cancel():
    ps = parse_observable("Z0 + 2 Z0 + X1 - X1", 2)
    assert [(t.coeff, t.ops) for t in ps.terms] == [(3.0, ((0, "Z"),))]


def test_duplicate_qubits_multiply_with_phase():
    # X0 Y0 = iZ0 (imaginary) -> non-Hermitian
    with pytest.raises(ObservableError):
        parse_observable("X0 Y0", 1)
    # X0 Y0 + Y0 X0 = 0 -> identically zero, but each is non-Hermitian alone
    with pytest.raises(ObservableError):
        parse_observable("X0 Y0 + Y0 X0", 1)
    # Z0 X1 Z0 -> X1 (Z0 squares away)
    ps = parse_observable("Z0 X1 Z0", 2)
    assert ps.terms == (PauliTerm(1.0, ((1, "X"),)),)
    # X0 X0 -> identity
    assert parse_observable("2 X0 X0", 1).terms == (PauliTerm(2.0, ()),)
    # (X0 Y1)(Y0 X1)... -> X0Y0 = iZ0, Y1X1 = -iZ1 -> product Z0 Z1 (real)
    ps = parse_observable("X0 Y1 Y0 X1", 2)
    assert ps.terms == (PauliTerm(1.0, ((0, "Z"), (1, "Z"))),)


@pytest.mark.parametrize(
    "spec,col",
    [
        ("", 0),
        ("   ", 0),
        ("Z0 +", 4),
        ("Z0 + + X1", 5),
        ("Z0 $ X1", 3),
        ("Z5", 1),
        ("Z0 + X9", 6),
        ("Q0", 0),
        ("Z", 0),
        ("Z0 * ", 5),
        ("X0 Y0", 0),
        ("Z0 + X1 Y1", 5),
    ],
)
def test_invalid_reports_column(spec, col):
    with pytest.raises(ObservableError) as ei:
        parse_observable(spec, 3)
    assert ei.value.column == col


def test_all_zero_rejected():
    with pytest.raises(ObservableError):
        parse_observable("Z0 - Z0", 2)


def test_presets():
    n = 4
    lz = parse_observable("preset:local_z", n)
    assert [t.coeff for t in lz.terms] == [0.25] * 4
    gz = parse_observable("preset:global_z", n)
    assert gz.terms == (PauliTerm(1.0, tuple((q, "Z") for q in range(n))),)
    zz = parse_observable("preset:zz_chain", n)
    assert len(zz.terms) == 3 and all(t.coeff == 1.0 for t in zz.terms)
    tf = parse_observable("preset:tfim", n)
    assert sum(1 for t in tf.terms if t.ops[0][1] == "X") == n
    assert {t.coeff for t in tf.terms} == {-1.0}
    tf5 = parse_observable("preset:tfim(h=0.5)", n)
    assert {t.coeff for t in tf5.terms if t.ops[0][1] == "X"} == {-0.5}
    assert parse_observable("preset:TFIM( h = 2 )", n).terms[-1].coeff == -2.0
    # round trip through text
    assert parse_observable(tf5.to_text(), n) == tf5


@pytest.mark.parametrize("spec", ["preset:nope", "preset:tfim(h=abc)", "preset:local_z(h=1)", "preset:"])
def test_bad_presets(spec):
    with pytest.raises(ObservableError):
        parse_observable(spec, 4)


def test_tfim_needs_two_qubits():
    with pytest.raises(ObservableError):
        parse_observable("preset:tfim", 1)


@pytest.mark.parametrize("n", [1, 3, 5])
def test_apply_pauli_term_matches_kron(n):
    rng = np.random.default_rng(n)
    state = rng.normal(size=1 << n) + 1j * rng.normal(size=1 << n)
    letters = {"X": X, "Y": Y, "Z": Z}
    for _ in range(25):
        k = int(rng.integers(0, n + 1))
        qs = sorted(rng.choice(n, size=k, replace=False).tolist())
        ops = tuple((q, "XYZ"[int(rng.integers(0, 3))]) for q in qs)
        term = PauliTerm(float(rng.normal()), ops)
        want = term.coeff * dense([(q, letters[p]) for q, p in ops], n) @ state
        assert np.allclose(apply_pauli_term(state, term, n), want, atol=1e-12)


def test_apply_pauli_term_batched_and_matrix():
    n = 3
    rng = np.random.default_rng(1)
    states = rng.normal(size=(4, 8)) + 0j
    term = PauliTerm(2.0, ((0, "Y"), (2, "X")))
    out = apply_pauli_term(states, term, n)
    ref = np.stack([apply_pauli_term(s, term, n) for s in states])
    assert np.allclose(out, ref)
    ps = parse_observable("0.5 Z0 Z1 + X2 + 0.3 Y0", n)
    m = pauli_sum_matrix(ps, n)
    assert np.allclose(m, m.conj().T)
    want = 0.5 * dense([(0, Z), (1, Z)], n) + dense([(2, X)], n) + 0.3 * dense([(0, Y)], n)
    assert np.allclose(m, want)


def test_apply_rejects_bad_shapes():
    with pytest.raises(ValueError):
        apply_pauli_term(np.zeros(4, dtype=complex), PauliTerm(1.0, ((0, "Z"),)), 3)
