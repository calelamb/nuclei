from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
qc = QuantumCircuit(2); qc.h(0); qc.cx(0, 1); qc.save_statevector()
r = AerSimulator(method='statevector').run(qc).result()
print(r.get_statevector())
