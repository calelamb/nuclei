import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
theta = params.get("theta", 0.3)
qc = QuantumCircuit(1); qc.ry(theta, 0)
p1 = float(abs(Statevector(qc).data[1])**2)
record_metric("p1", p1)
