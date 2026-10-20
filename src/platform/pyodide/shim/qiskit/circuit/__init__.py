from _nuclei_unsupported import make_getattr
from qiskit.circuit.bits import ClassicalRegister, Clbit, QuantumRegister, Qubit
from qiskit.circuit.gates import Gate, Instruction, Measure, Barrier, Reset
from qiskit.circuit.quantumcircuit import (
    CircuitInstruction, InstructionSet, QuantumCircuit,
)

__getattr__ = make_getattr("qiskit.circuit")
