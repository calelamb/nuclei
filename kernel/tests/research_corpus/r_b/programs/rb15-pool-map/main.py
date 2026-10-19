import multiprocessing

from qiskit import QuantumCircuit

RAN = False


def square(x):
    return x * x


qc = QuantumCircuit(1, 1)
qc.h(0)
qc.measure(0, 0)

if __name__ == "__main__":
    with multiprocessing.get_context("spawn").Pool(2) as pool:
        print(pool.map(square, range(4)))
    RAN = True

if __name__ != "__mp_main__":  # spawn children re-run this file as __mp_main__
    assert RAN, "the main guard did not run"
