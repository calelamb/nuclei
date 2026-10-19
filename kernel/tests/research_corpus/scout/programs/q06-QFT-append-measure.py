from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
qc = QuantumCircuit(3, 3)
qc.x(0)
qc.append(QFT(3), range(3))
qc.measure(range(3), range(3))
