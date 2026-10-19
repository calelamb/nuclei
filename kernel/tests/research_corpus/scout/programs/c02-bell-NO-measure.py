import cirq
q = cirq.LineQubit.range(2)
circuit = cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]))
