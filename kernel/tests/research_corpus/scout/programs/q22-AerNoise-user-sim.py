from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, depolarizing_error
nm = NoiseModel()
nm.add_all_qubit_quantum_error(depolarizing_error(0.01, 1), ['h'])
nm.add_all_qubit_quantum_error(depolarizing_error(0.03, 2), ['cx'])
qc = QuantumCircuit(2, 2)
qc.h(0); qc.cx(0, 1); qc.measure([0, 1], [0, 1])
sim = AerSimulator(noise_model=nm)
counts = sim.run(transpile(qc, sim), shots=2000).result().get_counts()
print(counts)
