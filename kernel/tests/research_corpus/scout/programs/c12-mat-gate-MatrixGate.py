import cirq
from scipy.stats import unitary_group
q = cirq.LineQubit.range(2)
U = unitary_group.rvs(4, random_state=1)
circuit = cirq.Circuit(cirq.MatrixGate(U).on(*q), cirq.measure(*q, key='m'))
