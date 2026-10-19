from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
qc = QuantumCircuit(4)
qc.h(range(4))
qc.append(QFT(4, inverse=True), range(4))
