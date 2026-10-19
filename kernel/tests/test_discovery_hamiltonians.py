"""Hamiltonian builders and exact ground energies (PRD 14 spec 6.3, vqe_ground_state)."""

from __future__ import annotations

import math
from functools import reduce

import numpy as np
import pytest

from kernel.discovery import hamiltonians as hm
from kernel.trainability.pauli import PauliSum, pauli_sum_matrix

_I = np.eye(2, dtype=complex)
_PAULI = {
    "X": np.array([[0, 1], [1, 0]], dtype=complex),
    "Y": np.array([[0, -1j], [1j, 0]], dtype=complex),
    "Z": np.array([[1, 0], [0, -1]], dtype=complex),
}


def kron_matrix(ps: PauliSum, n: int) -> np.ndarray:
    """Independent oracle: Kronecker products, little-endian (qubit 0 is the LAST factor)."""
    total = np.zeros((1 << n, 1 << n), dtype=complex)
    for term in ps.terms:
        ops = dict(term.ops)
        factors = [_PAULI[ops[q]] if q in ops else _I for q in reversed(range(n))]
        total += term.coeff * reduce(np.kron, factors)
    return total


def dense_e0(ps: PauliSum, n: int) -> float:
    return float(np.linalg.eigvalsh(kron_matrix(ps, n))[0])


@pytest.mark.parametrize("n", [2, 3, 4, 5, 6])
def test_pauli_sum_matrix_agrees_with_kron_oracle(n):
    ps = hm.tfim(n, 0.7)
    assert np.allclose(pauli_sum_matrix(ps, n), kron_matrix(ps, n))


def test_tfim_n2_h1_is_minus_sqrt5():
    assert hm.exact_ground_energy(hm.tfim(2, 1.0), 2) == pytest.approx(-math.sqrt(5), abs=1e-12)


@pytest.mark.parametrize("n", [2, 3, 4, 5, 6, 8])
def test_tfim_critical_open_chain_closed_form(n):
    # Open TFIM at J = h = 1: E0 = 1 - 1 / sin(pi / (2 (2n + 1))).
    expected = 1.0 - 1.0 / math.sin(math.pi / (2 * (2 * n + 1)))
    assert hm.exact_ground_energy(hm.tfim(n, 1.0), n) == pytest.approx(expected, abs=1e-10)


@pytest.mark.parametrize("n", [3, 4, 5])
def test_exact_energy_matches_dense_diagonalization(n):
    for ps in (hm.tfim(n, 1.0), hm.heisenberg(n), hm.xxz(n, 0.5), hm.tfim(n, 1.3, periodic=True)):
        assert hm.exact_ground_energy(ps, n) == pytest.approx(dense_e0(ps, n), abs=1e-10)


def test_heisenberg_and_xxz_two_site_known_values():
    assert hm.exact_ground_energy(hm.heisenberg(2), 2) == pytest.approx(-3.0)
    # XX + YY + d ZZ: eigenvalues d (twice) and -d +- 2  ->  E0 = min(d, -d - 2).
    assert hm.exact_ground_energy(hm.xxz(2, 0.5), 2) == pytest.approx(-2.5)


def test_periodic_adds_wrap_bond_only_for_three_or_more_sites():
    assert len(hm.tfim(2, 1.0, periodic=True).terms) == len(hm.tfim(2, 1.0).terms)
    assert len(hm.tfim(4, 1.0, periodic=True).terms) == len(hm.tfim(4, 1.0).terms) + 1


def test_sparse_path_matches_dense_path():
    ps = hm.xxz(8, 0.5)
    assert hm._sparse_ground_energy(ps, 8) == pytest.approx(hm.exact_ground_energy(ps, 8), abs=1e-8)


def test_eleven_qubits_uses_sparse_solver_and_matches_closed_form():
    n = 11
    expected = 1.0 - 1.0 / math.sin(math.pi / (2 * (2 * n + 1)))
    assert hm.exact_ground_energy(hm.tfim(n, 1.0), n) == pytest.approx(expected, abs=1e-7)


def test_sparse_without_scipy_is_refused(monkeypatch):
    monkeypatch.setattr(hm, "_scipy_sparse", lambda: None)
    with pytest.raises(hm.HamiltonianError, match="scipy"):
        hm.exact_ground_energy(hm.tfim(11, 1.0), 11)
    assert hm.exact_ground_energy(hm.tfim(4, 1.0), 4) < 0  # dense path still works


def test_more_than_twelve_qubits_is_refused():
    with pytest.raises(hm.HamiltonianError, match="at most 12"):
        hm.exact_ground_energy(hm.tfim(13, 1.0), 13)


def test_build_hamiltonian_from_config_objects():
    assert hm.build_hamiltonian({"kind": "tfim", "n_qubits": 3, "h": 2.0}).terms == hm.tfim(3, 2.0).terms
    assert hm.build_hamiltonian({"kind": "xxz", "n_qubits": 3, "delta": 0.25}).terms == hm.xxz(3, 0.25).terms
    pauli = hm.build_hamiltonian({"kind": "pauli", "n_qubits": 2, "pauli": "Z0*Z1 + 0.5*X0"})
    assert hm.exact_ground_energy(pauli, 2) == pytest.approx(dense_e0(pauli, 2))


@pytest.mark.parametrize("spec", [
    {"kind": "nope", "n_qubits": 3},
    {"kind": "tfim", "n_qubits": 1},
    {"kind": "pauli", "n_qubits": 2},
    {"kind": "pauli", "n_qubits": 2, "pauli": "Z0*Z5"},
])
def test_bad_hamiltonian_specs_raise(spec):
    with pytest.raises(hm.HamiltonianError):
        hm.build_hamiltonian(spec)
