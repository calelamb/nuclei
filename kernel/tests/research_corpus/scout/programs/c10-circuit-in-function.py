import cirq
def build():
    q = cirq.LineQubit.range(2)
    return cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]), cirq.measure(*q))
print(build())
