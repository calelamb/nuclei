import cirq
q = cirq.LineQubit.range(3)
circuit = cirq.Circuit(cirq.H.on_each(*q), cirq.measure(q[0], key='a'), cirq.measure(q[1], q[2], key='b'))
