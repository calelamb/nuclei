from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp
from qiskit.primitives import Estimator
qc = QuantumCircuit(2); qc.h(0); qc.cx(0, 1)
print(Estimator().run(qc, SparsePauliOp("ZZ")).result().values)
qc.measure_all()
