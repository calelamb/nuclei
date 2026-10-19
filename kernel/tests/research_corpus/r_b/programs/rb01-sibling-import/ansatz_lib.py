"""A researcher's helper module that lives next to main.py."""
from qiskit import QuantumCircuit


def build(n_qubits: int) -> QuantumCircuit:
    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.h(0)
    for q in range(1, n_qubits):
        qc.cx(0, q)
    qc.measure(range(n_qubits), range(n_qubits))
    return qc
