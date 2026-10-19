from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT

# Opaque library block + non-basis gates, no measurement.
qc = QuantumCircuit(3)
qc.h(0)
qc.append(QFT(3), range(3))
qc.iswap(0, 1)
qc.rzz(0.3, 1, 2)
qc.rxx(0.2, 0, 2)
qc.cswap(0, 1, 2)
