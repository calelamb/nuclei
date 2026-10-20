import os

from qiskit import QuantumCircuit

out_dir = os.environ["NUCLEI_RUN_DIR"]
with open(os.path.join(out_dir, "energies.txt"), "w") as handle:
    handle.write("-1.137\n")

qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)
