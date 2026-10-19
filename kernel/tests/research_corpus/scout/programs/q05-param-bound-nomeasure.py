import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit import ParameterVector
theta = ParameterVector('t', 4)
qc = QuantumCircuit(2)
qc.ry(theta[0], 0); qc.ry(theta[1], 1); qc.cx(0, 1); qc.rz(theta[2], 0); qc.rx(theta[3], 1)
bound = qc.assign_parameters(np.array([0.1, 0.2, 0.3, 0.4]))
