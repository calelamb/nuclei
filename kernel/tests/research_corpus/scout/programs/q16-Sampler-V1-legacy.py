from qiskit import QuantumCircuit
from qiskit.primitives import Sampler
qc = QuantumCircuit(2); qc.h(0); qc.cx(0, 1); qc.measure_all()
print(Sampler().run(qc).result().quasi_dists)
