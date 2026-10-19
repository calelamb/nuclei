from qiskit import QuantumCircuit, transpile
qc = QuantumCircuit(3, 3)
qc.h(0); qc.ccx(0, 1, 2); qc.swap(0, 2); qc.measure([0, 1, 2], [0, 1, 2])
tqc = transpile(qc, basis_gates=['rz', 'sx', 'cx'], optimization_level=1)
