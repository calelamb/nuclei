import json

from qiskit import QuantumCircuit

with open("hamiltonian.json") as handle:
    n = json.load(handle)["qubits"]

qc = QuantumCircuit(n, n)
qc.h(0)
qc.cx(0, 1)
qc.measure(range(n), range(n))
