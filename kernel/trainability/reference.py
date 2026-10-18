"""Deliberately naive statevector oracle (the correctness reference).

No fusion, no batching, no cleverness: every IR gate is applied as its own
dense matrix via one ``tensordot`` on the full state, using the gate's matrix
from ``GATE_SPECS`` directly (including ``U``, which the compiler decomposes,
so the oracle is independent of the compiler's canonicalization).  The
observable is expanded to a dense matrix with explicit ``kron`` products.

Conventions: qubit ``q`` is bit ``q`` of the basis index; in the
``(2,)*n`` tensor view (C order) qubit ``q`` lives on axis ``n-1-q``.
"""

from __future__ import annotations

import numpy as np

from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.pauli import PauliSum

__all__ = [
    "REFERENCE_MAX_QUBITS",
    "reference_state",
    "reference_expectation",
    "reference_observable_matrix",
]

REFERENCE_MAX_QUBITS = 14

_PAULI = {
    "I": np.eye(2, dtype=np.complex128),
    "X": np.array([[0, 1], [1, 0]], dtype=np.complex128),
    "Y": np.array([[0, -1j], [1j, 0]], dtype=np.complex128),
    "Z": np.array([[1, 0], [0, -1]], dtype=np.complex128),
}


def _apply(state: np.ndarray, matrix: np.ndarray, qubits: tuple[int, ...], n: int) -> np.ndarray:
    k = len(qubits)
    axes = [n - 1 - q for q in reversed(qubits)]  # most significant gate bit first
    gate = matrix.reshape((2,) * (2 * k))
    out = np.tensordot(gate, state, axes=(list(range(k, 2 * k)), axes))
    return np.moveaxis(out, list(range(k)), axes)


def reference_state(
    circuit: ParamCircuit, values: np.ndarray, initial: np.ndarray | None = None
) -> np.ndarray:
    """Final statevector ``(2**n,)`` for one parameter vector."""
    n = circuit.n_qubits
    if n > REFERENCE_MAX_QUBITS:
        raise IrError("too_many_qubits", f"reference oracle is limited to {REFERENCE_MAX_QUBITS} qubits")
    if initial is None:
        psi = np.zeros(1 << n, dtype=np.complex128)
        psi[0] = 1.0
    else:
        psi = np.array(initial, dtype=np.complex128).reshape(-1)
        if psi.shape[0] != 1 << n:
            raise IrError("invalid_ir", f"initial state must have length 2**{n}")
    tensor = psi.reshape((2,) * n)
    for gate, angles in circuit.bind_vector(values):
        tensor = _apply(tensor, GATE_SPECS[gate.name].matrix(angles), gate.qubits, n)
    return tensor.reshape(-1)


def reference_observable_matrix(observable: PauliSum, n: int) -> np.ndarray:
    """Dense observable via explicit kron (qubit n-1 leftmost)."""
    dim = 1 << n
    total = np.zeros((dim, dim), dtype=np.complex128)
    for term in observable.terms:
        letters = dict(term.ops)
        mat = np.eye(1, dtype=np.complex128)
        for q in range(n - 1, -1, -1):
            mat = np.kron(mat, _PAULI[letters.get(q, "I")])
        total += term.coeff * mat
    return total


def reference_expectation(
    circuit: ParamCircuit,
    values: np.ndarray,
    observable: PauliSum,
    initial: np.ndarray | None = None,
) -> float:
    """``<psi|O|psi>`` (real) for one parameter vector."""
    psi = reference_state(circuit, values, initial)
    o = reference_observable_matrix(observable, circuit.n_qubits)
    return float(np.real(np.vdot(psi, o @ psi)))
