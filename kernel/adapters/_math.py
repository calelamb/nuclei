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


def bloch_coords_from_statevector(
    sv_data: Sequence[complex] | np.ndarray, n_qubits: int, little_endian: bool
) -> list[dict]:
    """Per-qubit Bloch coordinates for `bloch_coords[i]` = display qubit i.

    `little_endian` selects the statevector axis for display qubit i:
    little-endian frameworks (Qiskit, qubit 0 = LSB) trace axis `n-1-i`;
    big-endian ones (Cirq with sorted qubit order) trace axis `i`. This is the
    single source of the convention the per-gate debugger and `simulate` share —
    see test_adapter_bloch_order.py.
    """
    coords = []
    for i in range(n_qubits):
        axis = (n_qubits - 1 - i) if little_endian else i
        rho = partial_trace_qubit(sv_data, n_qubits, axis)
        coords.append(
            {
                "x": float(2 * rho[0, 1].real),
                "y": float(2 * rho[0, 1].imag),
                "z": float(rho[0, 0].real - rho[1, 1].real),
            }
        )
    return coords


def step_state_payload(
    sv_data: Sequence[complex] | np.ndarray, n_qubits: int, little_endian: bool
) -> dict:
    """One debugger step's slim state: probabilities + per-qubit Bloch coords.

    Deliberately omits the full state vector (2**n entries per step would blow
    up the trace payload); the Bloch panel and histogram — the two surfaces the
    debugger reuses — need only these two.
    """
    probabilities = {
        format(i, f"0{n_qubits}b"): float(abs(c) ** 2)
        for i, c in enumerate(np.asarray(sv_data).ravel())
        if abs(c) ** 2 > 1e-10
    }
    return {
        "probabilities": probabilities,
        "bloch_coords": bloch_coords_from_statevector(sv_data, n_qubits, little_endian),
    }


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
