from qiskit import QuantumCircuit
for i in range(100000): print("line", i)
qc = QuantumCircuit(1,1); qc.measure(0,0)
