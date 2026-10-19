from cirq.circuits import Circuit
from cirq.contrib.svg import SVGCircuit
from cirq.devices import LineQubit
from cirq.ops import CNOT, H, measure

a, b = LineQubit.range(2)
circuit = Circuit(H(a), CNOT(a, b), measure(a, b, key="m"))
