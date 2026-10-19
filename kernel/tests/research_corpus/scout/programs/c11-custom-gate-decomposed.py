import cirq, numpy as np
class MyGate(cirq.Gate):
    def _num_qubits_(self): return 1
    def _unitary_(self): return np.array([[0, 1], [1, 0]])
q = cirq.LineQubit(0)
circuit = cirq.Circuit(MyGate().on(q), cirq.measure(q, key='m'))
