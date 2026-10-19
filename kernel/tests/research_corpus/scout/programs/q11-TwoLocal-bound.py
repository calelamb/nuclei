import numpy as np
from qiskit.circuit.library import TwoLocal
ansatz = TwoLocal(3, ['ry', 'rz'], 'cz', reps=2, entanglement='linear')
qc = ansatz.assign_parameters(np.linspace(0.1, 1.2, ansatz.num_parameters))
qc.measure_all()
