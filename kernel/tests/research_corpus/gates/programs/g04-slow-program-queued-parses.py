import time

from qiskit import QuantumCircuit

time.sleep(1.0)  # stands in for a classical optimisation loop: ~1 s of program time
qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
