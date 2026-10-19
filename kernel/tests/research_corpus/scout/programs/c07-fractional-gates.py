import cirq
q = cirq.LineQubit.range(2)
circuit = cirq.Circuit(cirq.X(q[0])**0.5, cirq.ZZ(q[0], q[1])**0.25, cirq.rx(0.4)(q[1]), cirq.measure(*q, key='m'))
