from qiskit.circuit.library import ZZFeatureMap
fm = ZZFeatureMap(3, reps=2)
qc = fm.assign_parameters([0.1, 0.5, 0.9])
qc.measure_all()
