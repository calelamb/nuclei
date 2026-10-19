"""Seed program: RY/RZ + CZ-brick ansatz on an open chain.

Every rotation has its own independent parameter and the only fixed gate is
CZ (Clifford), so the trusted Pauli-propagation estimator applies at every
size. The Discovery Engine searches for ansatzes that stay trainable while
resisting that estimator. Hardness here means resistance to this estimator
under this budget, not a proof of classical hardness.
"""
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector


def build(n_qubits: int, n_layers: int) -> QuantumCircuit:
    qc = QuantumCircuit(n_qubits)
    # EVOLVE-BLOCK-START
    theta = ParameterVector("theta", 2 * n_qubits * n_layers)
    k = 0
    for _ in range(n_layers):
        for q in range(n_qubits):
            qc.ry(theta[k], q)
            k += 1
            qc.rz(theta[k], q)
            k += 1
        for start in (0, 1):
            for q in range(start, n_qubits - 1, 2):
                qc.cz(q, q + 1)
    # EVOLVE-BLOCK-END
    return qc
