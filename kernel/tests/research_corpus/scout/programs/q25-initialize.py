import numpy as np
from qiskit import QuantumCircuit
qc = QuantumCircuit(2, 2)
qc.initialize(np.array([1, 1j, 0, 0]) / np.sqrt(2), [0, 1])
qc.measure([0, 1], [0, 1])
