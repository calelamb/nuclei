from qiskit import QuantumCircuit
def build():
    qc = QuantumCircuit(2, 2); qc.h(0); qc.cx(0, 1); qc.measure([0, 1], [0, 1]); return qc
if __name__ == "__main__":
    qc = build()
    print("built", qc.num_qubits)
