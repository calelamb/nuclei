from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT
qc = QuantumCircuit(3)
qc.x(0)
qc.compose(QFT(3).decompose(reps=2), inplace=True)
qc.measure_all()
