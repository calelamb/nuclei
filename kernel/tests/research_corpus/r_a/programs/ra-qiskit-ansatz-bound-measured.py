from qiskit import QuantumCircuit
from qiskit.circuit.library import EfficientSU2

# A bound ansatz appended as one block, then measured: sampled counts plus exact probabilities.
ansatz = EfficientSU2(2, reps=1)
bound = ansatz.assign_parameters([0.1 * (i + 1) for i in range(ansatz.num_parameters)])
qc = QuantumCircuit(2, 2)
qc.append(bound, [0, 1])
qc.measure([0, 1], [0, 1])
