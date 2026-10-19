from qiskit import QuantumCircuit
qc = QuantumCircuit(3, 3)
qc.h(0); qc.cp(0.5, 0, 1); qc.rzz(0.3, 1, 2); qc.rxx(0.2, 0, 2); qc.ryy(0.1, 0, 1)
qc.cswap(0, 1, 2); qc.iswap(0, 1); qc.sdg(2); qc.tdg(1); qc.u(0.1, 0.2, 0.3, 0); qc.sx(1)
qc.barrier(); qc.measure([0, 1, 2], [0, 1, 2])
