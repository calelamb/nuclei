import cirq
qs = cirq.GridQubit.rect(2, 2)
circuit = cirq.Circuit(cirq.H.on_each(*qs), cirq.CZ(qs[0], qs[1]), cirq.CZ(qs[2], qs[3]), cirq.measure(*qs, key='m'))
