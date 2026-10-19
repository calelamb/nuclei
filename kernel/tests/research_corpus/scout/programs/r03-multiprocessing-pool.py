from multiprocessing import Pool
from qiskit import QuantumCircuit
def f(x): return x*x
with Pool(2) as p:
    print(p.map(f, range(4)))
qc = QuantumCircuit(1,1); qc.measure(0,0)
