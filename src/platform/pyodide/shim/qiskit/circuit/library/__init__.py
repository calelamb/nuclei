"""Standard gate classes plus the QFT library circuit."""

import numpy as np

from _nuclei_unsupported import make_getattr
from qiskit.circuit.gates import (  # noqa: F401
    CCXGate, CCZGate, CHGate, CPhaseGate, CRXGate, CRYGate, CRZGate, CSwapGate,
    CXGate, CYGate, CZGate, HGate, IGate, MCXGate, PhaseGate, RXGate, RYGate,
    RZGate, SGate, SXGate, SXdgGate, SdgGate, SwapGate, TGate, TdgGate, U1Gate,
    U3Gate, UGate, UnitaryGate, XGate, YGate, ZGate,
)
from qiskit.circuit.quantumcircuit import QuantumCircuit


def QFT(num_qubits=None, approximation_degree=0, do_swaps=True, inverse=False,
        insert_barriers=False, name=None):
    """Quantum Fourier transform circuit, built like Qiskit's own QFT."""
    if num_qubits is None:
        num_qubits = 0
    qc = QuantumCircuit(num_qubits, name=name or ("IQFT" if inverse else "QFT"))
    for j in reversed(range(num_qubits)):
        qc.h(j)
        for k in range(j):
            qc.cp(np.pi / 2 ** (j - k), k, j)
        if insert_barriers:
            qc.barrier()
    if do_swaps:
        for i in range(num_qubits // 2):
            qc.swap(i, num_qubits - i - 1)
    return qc.inverse() if inverse else qc


__getattr__ = make_getattr("qiskit.circuit.library")
