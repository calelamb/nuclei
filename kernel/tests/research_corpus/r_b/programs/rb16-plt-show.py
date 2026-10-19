import matplotlib.pyplot as plt
from qiskit import QuantumCircuit

plt.plot([0, 1, 2], [1.0, 0.5, 0.25])
plt.title("convergence")
plt.show()

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
