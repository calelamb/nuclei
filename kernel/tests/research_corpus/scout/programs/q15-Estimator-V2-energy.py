import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp
from qiskit.primitives import StatevectorEstimator
H = SparsePauliOp.from_list([("ZZ", 1.0), ("XI", 0.5), ("IX", 0.5)])
qc = QuantumCircuit(2)
qc.ry(0.4, 0); qc.cx(0, 1); qc.ry(0.9, 1)
est = StatevectorEstimator()
e = est.run([(qc, H)]).result()[0].data.evs
print("energy", float(e))
