import os, subprocess
from qiskit import QuantumCircuit
print(sorted(k for k in os.environ if k.startswith('NUCLEI')))
qc = QuantumCircuit(1,1); qc.measure(0,0)
