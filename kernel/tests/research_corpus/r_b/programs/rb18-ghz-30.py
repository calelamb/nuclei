from qiskit import QuantumCircuit

n = 30
qc = QuantumCircuit(n, n)
qc.h(0)
for q in range(1, n):
    qc.cx(0, q)
qc.measure(range(n), range(n))
