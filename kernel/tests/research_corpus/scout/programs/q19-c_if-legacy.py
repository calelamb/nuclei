from qiskit import QuantumCircuit
qc = QuantumCircuit(2, 2)
qc.h(0); qc.measure(0, 0); qc.x(1).c_if(0, 1); qc.measure(1, 1)
