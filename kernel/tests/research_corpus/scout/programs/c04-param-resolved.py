import cirq, sympy
q = cirq.LineQubit.range(2)
t = sympy.Symbol('t')
circuit0 = cirq.Circuit(cirq.ry(t)(q[0]), cirq.CNOT(q[0], q[1]), cirq.measure(*q, key='m'))
circuit = cirq.resolve_parameters(circuit0, {'t': 0.7})
