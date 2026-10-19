import cirq
q = cirq.LineQubit.range(2)
circuit = cirq.Circuit(cirq.ry(0.4)(q[0]), cirq.CNOT(q[0], q[1]))
H = cirq.Z(q[0]) * cirq.Z(q[1]) + 0.5 * cirq.X(q[0])
sv = cirq.Simulator().simulate(circuit).final_state_vector
print(H.expectation_from_state_vector(sv, {q[0]: 0, q[1]: 1}))
