import noise

from qiskit import QuantumCircuit

assert noise.MARKER == "researcher-noise", noise.__file__

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
