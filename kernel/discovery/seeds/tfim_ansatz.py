"""Seed program: hardware-efficient RY/CZ ansatz for the transverse-field Ising model.

The evaluator trains the free parameters itself and compares against the
exact ground energy. The Discovery Engine evolves only the code between the
EVOLVE markers; fewer parameters at the same accuracy scores better.
"""
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector


def build(n_qubits: int) -> QuantumCircuit:
    qc = QuantumCircuit(n_qubits)
    # EVOLVE-BLOCK-START
    layers = 2
    theta = ParameterVector("theta", n_qubits * (layers + 1))
    k = 0
    for _ in range(layers):
        for q in range(n_qubits):
            qc.ry(theta[k], q)
            k += 1
        for q in range(n_qubits - 1):
            qc.cz(q, q + 1)
    for q in range(n_qubits):
        qc.ry(theta[k], q)
        k += 1
    # EVOLVE-BLOCK-END
    return qc
