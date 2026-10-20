import models

from qiskit import QuantumCircuit

assert models.MARKER == "researcher-models", models.__file__

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
