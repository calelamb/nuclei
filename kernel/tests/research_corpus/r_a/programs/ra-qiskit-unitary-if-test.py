import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import random_unitary

# A matrix parameter, a nested block and mid-circuit feedforward in one program.
qc = QuantumCircuit(2, 2)
qc.unitary(random_unitary(4, seed=5), [0, 1])
qc.measure(0, 0)
with qc.if_test((qc.clbits[0], 1)):
    qc.x(1)
qc.measure(1, 1)
