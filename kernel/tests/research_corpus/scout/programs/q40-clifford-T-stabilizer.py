from qiskit import QuantumCircuit
qc = QuantumCircuit(3, 3)
qc.h(0); qc.s(0); qc.cx(0, 1); qc.cz(1, 2); qc.t(2); qc.measure([0, 1, 2], [0, 1, 2])
