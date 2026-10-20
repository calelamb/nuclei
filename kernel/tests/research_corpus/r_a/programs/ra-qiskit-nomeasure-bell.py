from qiskit import QuantumCircuit

# No measurement on purpose: Run shows the exact distribution, it does not add one.
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
