"""Hamiltonian variational ansatz for the transverse-field Ising chain.

Its generators {ZZ, X} span the free-fermion algebra so(2n): dim grows as
n(2n-1), so it is trainable and also classically simulable (g-sim).
"""
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter

n_qubits = params.get("n_qubits", 6)
n_layers = params.get("n_layers", 3)

qc = QuantumCircuit(n_qubits)
for layer in range(n_layers):
    gamma = Parameter(f"γ{layer}")
    beta = Parameter(f"β{layer}")
    for q in range(n_qubits - 1):
        qc.rzz(gamma, q, q + 1)
    for q in range(n_qubits):
        qc.rx(beta, q)

nuclei_observable = "preset:tfim"
