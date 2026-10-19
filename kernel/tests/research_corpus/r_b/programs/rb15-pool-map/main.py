import multiprocessing

from qiskit import QuantumCircuit


assert __name__ == "__main__"


def square(x):
    return x * x


qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)

if __name__ == "__main__":
    with multiprocessing.get_context("spawn").Pool(2) as pool:
        print(pool.map(square, range(4)))
