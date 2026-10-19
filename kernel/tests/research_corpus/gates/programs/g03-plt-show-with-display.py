import matplotlib.pyplot as plt
from qiskit import QuantumCircuit

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
plt.plot([0, 1, 2], [0, 1, 4])
plt.show()
