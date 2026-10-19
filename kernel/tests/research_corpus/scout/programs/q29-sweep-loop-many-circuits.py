import numpy as np
from qiskit import QuantumCircuit
circuits = []
for th in np.linspace(0, np.pi, 5):
    c = QuantumCircuit(1, 1); c.ry(th, 0); c.measure(0, 0); circuits.append(c)
qc = circuits[-1]
