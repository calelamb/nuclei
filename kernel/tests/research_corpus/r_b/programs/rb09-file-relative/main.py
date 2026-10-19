import json
import os

from qiskit import QuantumCircuit

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "angles.json")) as handle:
    n = json.load(handle)["qubits"]

qc = QuantumCircuit(n, n)
qc.h(0)
qc.cx(0, 1)
qc.measure(range(n), range(n))
