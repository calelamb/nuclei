import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import random_unitary
qc = QuantumCircuit(2, 2)
qc.unitary(random_unitary(4, seed=3), [0, 1])
qc.measure([0, 1], [0, 1])
