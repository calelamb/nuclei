from qiskit import QuantumCircuit
qc = QuantumCircuit(2, 2)
qc.h(0); qc.cx(0, 1); qc.measure(0, 0); qc.reset(0); qc.h(0); qc.measure(1, 1)
