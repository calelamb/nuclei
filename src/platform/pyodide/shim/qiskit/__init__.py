"""Qiskit (browser subset).

A small pure-Python/numpy implementation of the parts of Qiskit that Nuclei's
lessons, challenges and playground use: QuantumCircuit with the common gates,
measurement, barriers, composition, statevector simulation (qiskit.quantum_info,
qiskit_aer.AerSimulator) and the QFT library circuit. Everything else raises
UnsupportedInBrowser pointing at the Nuclei desktop app, which runs full Qiskit.
"""

from _nuclei_unsupported import UnsupportedInBrowser, unsupported, make_getattr
from qiskit.exceptions import QiskitError
from qiskit.circuit.bits import ClassicalRegister, Clbit, QuantumRegister, Qubit
from qiskit.circuit.quantumcircuit import QuantumCircuit

__version__ = "browser-subset"
IS_BROWSER_SUBSET = True


def transpile(*_args, **_kwargs):
    unsupported("qiskit.transpile()")


def execute(*_args, **_kwargs):
    unsupported("qiskit.execute()")


__getattr__ = make_getattr("qiskit")
