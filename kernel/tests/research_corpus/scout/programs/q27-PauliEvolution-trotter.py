from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp
from qiskit.circuit.library import PauliEvolutionGate
H = SparsePauliOp.from_list([("ZZI", 1.0), ("IZZ", 1.0), ("XII", 0.7), ("IXI", 0.7), ("IIX", 0.7)])
qc = QuantumCircuit(3)
qc.append(PauliEvolutionGate(H, time=0.5), range(3))
qc.measure_all()
