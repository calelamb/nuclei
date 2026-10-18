"""Seed program: prepare an n-qubit W state from elementary gates.

The Discovery Engine evolves only the code between the EVOLVE markers. The
trusted evaluator computes the fidelity itself and counts two-qubit gates;
this program only builds the circuit.

Seed cost: each cascade step is a controlled-RY (2 CX) plus a CX, so 3(n-1)
two-qubit gates in total.
"""
import numpy as np
from qiskit import QuantumCircuit


def build(n_qubits: int) -> QuantumCircuit:
    qc = QuantumCircuit(n_qubits)
    # EVOLVE-BLOCK-START
    # Put the excitation on qubit 0, then share it down the chain: a
    # controlled-RY "beam splitter" (decomposed into RY + CX) followed by a
    # CX that clears the control.
    qc.x(0)
    for k in range(n_qubits - 1):
        remaining = n_qubits - k
        angle = 2 * np.arccos(np.sqrt(1 / remaining))
        qc.ry(angle / 2, k + 1)
        qc.cx(k, k + 1)
        qc.ry(-angle / 2, k + 1)
        qc.cx(k, k + 1)
        qc.cx(k + 1, k)
    # EVOLVE-BLOCK-END
    return qc
