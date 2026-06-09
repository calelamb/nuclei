"""Shared math + layout helpers for adapters.

Extracted from qiskit_adapter so source-mode adapters (Q#) can reuse the
exact same partial-trace and greedy-layering behavior. Keeping one copy
guarantees every framework's Bloch coords and circuit layout agree.
"""

from collections.abc import Sequence

import numpy as np


def partial_trace_qubit(
    statevector: Sequence[complex] | np.ndarray, n_qubits: int, qubit: int
) -> np.ndarray:
    """Compute the reduced density matrix for a single qubit."""
    sv = np.array(statevector).reshape([2] * n_qubits)
    # Sum over all qubits except the target
    axes_to_trace = [i for i in range(n_qubits) if i != qubit]
    rho = np.tensordot(sv, sv.conj(), axes=(axes_to_trace, axes_to_trace))
    return rho


def assign_layer(qubit_layers: dict[int, int], qubits: list[int]) -> int:
    """Greedy layer assignment: place a gate in the earliest layer where all
    involved qubits are free, then mark those qubits busy through that layer.

    Mutates qubit_layers in place and returns the assigned layer. Circuit
    depth afterwards is `max(qubit_layers.values()) if qubit_layers else 0`.
    """
    layer = max(qubit_layers.get(q, 0) for q in qubits) if qubits else 0
    for q in qubits:
        qubit_layers[q] = layer + 1
    return layer
