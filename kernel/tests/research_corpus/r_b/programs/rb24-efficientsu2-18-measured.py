# A library ansatz above the 16-qubit full-result line: it must run on the lean path exactly as it
# does below it (Aer needs the block expanded into its basis first; audit R-2 / design risk 12).
from qiskit import QuantumCircuit
from qiskit.circuit.library import EfficientSU2

n = 18
ansatz = EfficientSU2(n, reps=1)
bound = ansatz.assign_parameters([0.1 * (i + 1) for i in range(ansatz.num_parameters)])

qc = QuantumCircuit(n, n)
qc.append(bound, range(n))
qc.measure(range(n), range(n))
