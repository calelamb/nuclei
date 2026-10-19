import symmetry

from qiskit import QuantumCircuit

assert symmetry.MARKER == "researcher-symmetry", symmetry.__file__

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
