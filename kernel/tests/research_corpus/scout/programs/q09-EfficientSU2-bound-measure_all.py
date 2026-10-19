import numpy as np
from qiskit.circuit.library import EfficientSU2
ansatz = EfficientSU2(4, reps=2)
rng = np.random.default_rng(7)
qc = ansatz.assign_parameters(rng.uniform(0, 2*np.pi, ansatz.num_parameters))
qc.measure_all()
