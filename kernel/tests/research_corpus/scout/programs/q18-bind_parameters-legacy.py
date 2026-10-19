from qiskit import QuantumCircuit
from qiskit.circuit import Parameter
t = Parameter('t')
qc = QuantumCircuit(1, 1); qc.rx(t, 0); qc.measure(0, 0)
qc = qc.bind_parameters({t: 0.5})
