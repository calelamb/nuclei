import kernel

from qiskit import QuantumCircuit

assert kernel.MARKER == "researcher-kernel", kernel.__file__

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
