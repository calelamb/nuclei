"""Small circuit builders shared by the trainability job tests."""

from __future__ import annotations

from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef


def build(n: int, spec: list[tuple], params: list[str] | None = None) -> ParamCircuit:
    """spec items: (name, qubits) or (name, qubits, angle_or_param_name)."""
    gates = []
    for i, item in enumerate(spec):
        name, qubits, *rest = item
        angles = tuple(ParamRef(a) if isinstance(a, str) else a for a in rest)
        gates.append(IrGate(name, tuple(qubits), angles, i))
    return ParamCircuit(n, gates, params or [], "native", [])


def deep_random(n: int, layers: int) -> ParamCircuit:
    """RY-RZ-RY rotations on every qubit then a CZ ring, repeated."""
    spec: list[tuple] = []
    params: list[str] = []
    for layer in range(layers):
        for q in range(n):
            for axis in ("RY", "RZ", "RY"):
                name = f"t{len(params)}"
                params.append(name)
                spec.append((axis, (q,), name))
        for q in range(n):
            if n > 1:
                spec.append(("CZ", (q, (q + 1) % n)))
    return build(n, spec, params)


def ghz(n: int) -> ParamCircuit:
    return build(n, [("H", (0,))] + [("CX", (q, q + 1)) for q in range(n - 1)])
