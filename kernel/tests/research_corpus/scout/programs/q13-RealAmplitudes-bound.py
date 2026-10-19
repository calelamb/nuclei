import numpy as np
from qiskit.circuit.library import RealAmplitudes
ra = RealAmplitudes(3, reps=2)
qc = ra.assign_parameters(np.full(ra.num_parameters, 0.3))
qc.measure_all()
