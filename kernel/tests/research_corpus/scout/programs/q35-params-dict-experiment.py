import numpy as np
from qiskit import QuantumCircuit
theta = params.get("theta", 0.3)
qc = QuantumCircuit(1, 1); qc.ry(theta, 0); qc.measure(0, 0)
record_metric("theta_used", float(theta))
