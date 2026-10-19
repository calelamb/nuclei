import cirq
q = cirq.LineQubit.range(3)
circuit = cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]), cirq.CNOT(q[1], q[2]))
res = cirq.Simulator().simulate(circuit)
print(res.final_state_vector)
