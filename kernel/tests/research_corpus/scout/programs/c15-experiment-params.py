import cirq
theta = params.get("theta", 0.3)
q = cirq.LineQubit(0)
circuit = cirq.Circuit(cirq.ry(theta)(q), cirq.measure(q, key='m'))
record_metric("theta_used", float(theta))
