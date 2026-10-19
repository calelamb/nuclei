from qiskit import QuantumCircuit
qc = QuantumCircuit(2, 2)
qc.h(0); qc.measure(0, 0)
with qc.if_test((qc.clbits[0], 1)):
    qc.x(1)
qc.measure(1, 1)
