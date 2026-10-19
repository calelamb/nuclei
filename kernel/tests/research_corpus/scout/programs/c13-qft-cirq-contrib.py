import cirq
q = cirq.LineQubit.range(3)
circuit = cirq.Circuit(cirq.qft(*q), cirq.measure(*q, key='m'))
