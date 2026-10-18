"""Hamiltonians for the ``vqe_ground_state`` evaluator, plus exact ground energies.

All builders return a :class:`~kernel.trainability.pauli.PauliSum` with the
little-endian convention used across the Lab (qubit ``q`` is bit ``q``).

Conventions (``J = 1`` throughout; open chain unless ``periodic``)::

    tfim        H = -sum Z_i Z_{i+1} - h sum X_i
    heisenberg  H = sum (X_i X_{i+1} + Y_i Y_{i+1} + Z_i Z_{i+1})
    xxz         H = sum (X_i X_{i+1} + Y_i Y_{i+1} + delta Z_i Z_{i+1})
    pauli       any user-written Pauli sum, e.g. ``"Z0*Z1 + 0.5*X0"``

``periodic`` adds the wrap-around bond (n-1, 0) when n >= 3 (for n = 2 it
would duplicate the existing bond, so it is ignored).

Exact ground energy ``E0``: dense ``eigvalsh`` for n <= 10; for 11 <= n <= 12
a matrix-free ``scipy.sparse.linalg.eigsh`` (smallest algebraic). Without
scipy, n > 10 is refused rather than guessed.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from kernel.trainability.pauli import (
    ObservableError,
    PauliSum,
    PauliTerm,
    apply_pauli_term,
    parse_observable,
    pauli_sum_matrix,
)

DENSE_MAX_QUBITS = 10
SPARSE_MAX_QUBITS = 12
KINDS = ("tfim", "heisenberg", "xxz", "pauli")


class HamiltonianError(ValueError):
    """Invalid Hamiltonian description or unsupported size."""


def _bonds(n: int, periodic: bool) -> list[tuple[int, int]]:
    bonds = [(i, i + 1) for i in range(n - 1)]
    if periodic and n >= 3:
        bonds.append((n - 1, 0))
    return bonds


def _pair(coeff: float, a: tuple[int, str], b: tuple[int, str]) -> PauliTerm:
    ops = tuple(sorted((a, b)))
    return PauliTerm(float(coeff), ops)


def tfim(n: int, h: float = 1.0, periodic: bool = False) -> PauliSum:
    terms = [_pair(-1.0, (i, "Z"), (j, "Z")) for i, j in _bonds(n, periodic)]
    terms += [PauliTerm(-float(h), ((q, "X"),)) for q in range(n)]
    return PauliSum(tuple(terms))


def xxz(n: int, delta: float = 1.0, periodic: bool = False) -> PauliSum:
    terms: list[PauliTerm] = []
    for i, j in _bonds(n, periodic):
        terms.append(_pair(1.0, (i, "X"), (j, "X")))
        terms.append(_pair(1.0, (i, "Y"), (j, "Y")))
        terms.append(_pair(delta, (i, "Z"), (j, "Z")))
    return PauliSum(tuple(terms))


def heisenberg(n: int, periodic: bool = False) -> PauliSum:
    return xxz(n, 1.0, periodic)


def build_hamiltonian(spec: dict[str, Any]) -> PauliSum:
    """Build from an evaluator-config ``hamiltonian`` object."""
    kind, n = spec.get("kind"), int(spec.get("n_qubits", 0))
    if n < 2:
        raise HamiltonianError("hamiltonian.n_qubits must be at least 2")
    periodic = bool(spec.get("periodic", False))
    if kind == "tfim":
        return tfim(n, float(spec.get("h", 1.0)), periodic)
    if kind == "heisenberg":
        return heisenberg(n, periodic)
    if kind == "xxz":
        return xxz(n, float(spec.get("delta", 0.5)), periodic)
    if kind == "pauli":
        text = spec.get("pauli")
        if not isinstance(text, str) or not text.strip():
            raise HamiltonianError("hamiltonian.pauli is required for kind 'pauli'")
        try:
            return parse_observable(text, n)
        except ObservableError as exc:
            raise HamiltonianError(f"hamiltonian.pauli: {exc.message} (column {exc.column})") from exc
    raise HamiltonianError(f"unknown hamiltonian kind {kind!r}")


def _scipy_sparse():
    try:
        import scipy.sparse.linalg as sla
    except ImportError:
        return None
    return sla


def exact_ground_energy(ps: PauliSum, n: int) -> float:
    """Lowest eigenvalue of ``ps`` on ``n`` qubits (see module doc for limits)."""
    if n < 1 or ps.max_qubit() >= n:
        raise HamiltonianError("Hamiltonian touches a qubit outside the register")
    if n > SPARSE_MAX_QUBITS:
        raise HamiltonianError(f"exact ground energy supports at most {SPARSE_MAX_QUBITS} qubits (got {n})")
    if n <= DENSE_MAX_QUBITS:
        return float(np.linalg.eigvalsh(pauli_sum_matrix(ps, n))[0])
    sla = _scipy_sparse()
    if sla is None:
        raise HamiltonianError(f"exact ground energy for n > {DENSE_MAX_QUBITS} needs scipy, which is not installed")
    dim = 1 << n

    def matvec(vec: np.ndarray) -> np.ndarray:
        vec = np.asarray(vec, dtype=np.complex128).reshape(dim)
        out = np.zeros(dim, dtype=np.complex128)
        for term in ps.terms:
            out += apply_pauli_term(vec, term, n)
        return out

    operator = sla.LinearOperator((dim, dim), matvec=matvec, dtype=np.complex128)
    start = np.random.default_rng(0).standard_normal(dim)
    values = sla.eigsh(operator, k=1, which="SA", v0=start, tol=1e-12, return_eigenvectors=False)
    return float(values[0])
