import json
from qiskit import QuantumCircuit
qc = QuantumCircuit(1,1); qc.measure(0,0)
print(open('params.json').read())
