import numpy as np
from scipy.optimize import minimize
from qiskit import QuantumCircuit
from qiskit.circuit import Parameter
from qiskit.quantum_info import SparsePauliOp, Statevector
H = SparsePauliOp.from_list([("ZZ", 0.5), ("XX", 0.3), ("ZI", -0.4), ("IZ", -0.4)])
a = Parameter('a'); b = Parameter('b')
qc = QuantumCircuit(2); qc.ry(a, 0); qc.ry(b, 1); qc.cx(0, 1)
def energy(x):
    s = Statevector(qc.assign_parameters({a: x[0], b: x[1]}))
    return float(np.real(s.expectation_value(H)))
res = minimize(energy, [0.1, 0.1], method="COBYLA")
print("E0 ~", res.fun)
final = qc.assign_parameters({a: res.x[0], b: res.x[1]})
final.measure_all()
