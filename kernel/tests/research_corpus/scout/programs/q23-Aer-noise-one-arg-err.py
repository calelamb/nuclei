from qiskit import QuantumCircuit
from qiskit_aer.noise import NoiseModel, depolarizing_error
nm = NoiseModel()
nm.add_all_qubit_quantum_error(depolarizing_error(0.01), ['h'])
qc = QuantumCircuit(1, 1); qc.h(0); qc.measure(0, 0)
