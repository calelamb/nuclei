import matplotlib
import matplotlib.pyplot as plt
import numpy as np
from qiskit import QuantumCircuit
qc = QuantumCircuit(1,1); qc.h(0); qc.measure(0,0)
plt.plot(np.arange(5)); plt.show()
