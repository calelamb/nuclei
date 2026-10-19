from qiskit import QuantumCircuit
a = QuantumCircuit(1, 1); a.h(0); a.measure(0, 0)
b = QuantumCircuit(2, 2); b.h(0); b.cx(0, 1); b.measure([0, 1], [0, 1])
