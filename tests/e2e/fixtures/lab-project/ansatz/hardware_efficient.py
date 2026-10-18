"""Hardware-efficient ansatz: RY layers + CZ ladder (a classic barren-plateau case).

Open the Trainability Lab and run the analyses. Sweep n_qubits to watch the
gradient variance collapse exponentially under the global observable.
"""
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector

n_qubits = params.get("n_qubits", 6)
n_layers = params.get("n_layers", n_qubits)

theta = ParameterVector("θ", n_qubits * n_layers)
qc = QuantumCircuit(n_qubits)
for layer in range(n_layers):
    for q in range(n_qubits):
        qc.ry(theta[layer * n_qubits + q], q)
    for q in range(n_qubits - 1):
        qc.cz(q, q + 1)

# Global cost: Z on every qubit.
nuclei_observable = "preset:global_z"
