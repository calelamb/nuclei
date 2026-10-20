from qiskit import QuantumCircuit

for i in range(100000):
    print("iteration", i)

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
