from cirq.circuits import Circuit
from cirq.contrib.svg import SVGCircuit
from cirq.ops import CNOT, H, LineQubit, measure

a, b = LineQubit.range(2)
circuit = Circuit(H(a), CNOT(a, b), measure(a, b, key="m"))
