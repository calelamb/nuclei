import cirq
q = cirq.LineQubit.range(2)
circuit = cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]), cirq.measure(*q, key='m'))
noisy = circuit.with_noise(cirq.depolarize(0.02))
