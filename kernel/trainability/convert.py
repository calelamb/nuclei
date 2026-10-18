"""Convert Qiskit / Cirq circuits to the parameterized IR (spec section 5.2).

Conventions
-----------
* ``IrGate.source_index`` equals the index of the gate in
  ``CircuitSnapshot.gates`` as enumerated by the framework adapters: for
  Qiskit the position in ``circuit.data`` (barriers and measurements count),
  for Cirq the flat position over ``moment.operations`` in moment order.
  Dropped instructions simply do not emit IR gates; decomposed ones (U, Cirq
  ``CXPowGate``) share one ``source_index``.
* Qubit order: Qiskit index is the IR qubit; Cirq sorted qubits map to 0..n-1.
* Global phases are dropped (they never change an expectation value).
* Angles are linear in at most one parameter: ``coeff * value + offset``.
"""

from __future__ import annotations

import math
from typing import Any

from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import (
    MAX_IR_QUBITS,
    Angle,
    IrError,
    IrGate,
    ParamCircuit,
    ParamRef,
)
from kernel.trainability.linetrace import GateLineMap

__all__ = ["from_qiskit", "from_cirq", "from_object"]

_QISKIT_DIRECT = {
    "id": "I", "h": "H", "x": "X", "y": "Y", "z": "Z", "s": "S", "sdg": "SDG",
    "t": "T", "tdg": "TDG", "sx": "SX", "sxdg": "SXDG", "rx": "RX", "ry": "RY",
    "rz": "RZ", "p": "P", "cx": "CX", "cy": "CY", "cz": "CZ", "ch": "CH",
    "swap": "SWAP", "iswap": "ISWAP", "ccx": "CCX", "ccz": "CCZ", "cswap": "CSWAP",
    "rxx": "RXX", "ryy": "RYY", "rzz": "RZZ", "rzx": "RZX", "crx": "CRX",
    "cry": "CRY", "crz": "CRZ", "cp": "CP", "cu1": "CP", "u1": "P",
}
_QISKIT_U = {"u", "u3", "u2"}
_HALF_PI = math.pi / 2


class _Builder:
    """Accumulates IR gates for one conversion."""

    def __init__(self, n: int, framework: str, params: list[str]) -> None:
        self.n, self.framework, self.params = n, framework, params
        self.gates: list[IrGate] = []
        self.notes: list[str] = []

    def emit(self, name: str, qubits, angles, index: int, line: int | None) -> None:
        spec = GATE_SPECS[name]
        if len(qubits) != spec.arity or len(angles) != spec.n_angles:
            raise IrError("unsupported_gate", f"{name} applied with the wrong arity or angle count")
        self.gates.append(IrGate(name, tuple(qubits), tuple(angles), index, line))

    def note_dropped(self, kind: str, count: int) -> None:
        if count:
            self.notes.append(f"dropped {count} {kind}{'' if count == 1 else 's'}")

    def build(self) -> ParamCircuit:
        return ParamCircuit(self.n, self.gates, list(self.params), self.framework, self.notes)


def _check_width(n: int) -> None:
    if n > MAX_IR_QUBITS:
        raise IrError("too_many_qubits", f"{n} qubits exceeds the IR limit of {MAX_IR_QUBITS}")


def _scale(a: Angle, factor: float) -> Angle:
    """``factor * a`` for a float or ParamRef angle."""
    if isinstance(a, ParamRef):
        return ParamRef(a.name, a.coeff * factor, a.offset * factor)
    return a * factor


# ------------------------------------------------------------------ Qiskit


def _qiskit_angle(p: Any) -> Angle:
    from qiskit.circuit import ParameterExpression

    if not isinstance(p, ParameterExpression):
        try:
            return float(p)
        except (TypeError, ValueError):
            raise IrError("unsupported_gate", f"non-numeric gate parameter {type(p).__name__}") from None
    free = list(p.parameters)
    if not free:
        return float(p)
    if len(free) > 1:
        raise IrError(
            "nonlinear_parameter",
            f"angle '{p}' depends on {len(free)} parameters; only one linear parameter per angle is supported",
        )
    param = free[0]
    grad = p.gradient(param)
    if isinstance(grad, ParameterExpression):
        if grad.parameters:
            raise IrError("nonlinear_parameter", f"angle '{p}' is not linear in {param.name}")
        grad = float(grad)
    offset = p.bind({param: 0.0}, allow_unknown_parameters=True)
    return ParamRef(param.name, float(grad), float(offset))


def _is_conditioned(op: Any) -> bool:
    """True for classically conditioned ops (``c_if``) and control-flow blocks."""
    if getattr(op, "blocks", None):
        return True
    # `Instruction.condition` is deprecated in Qiskit 1.3+; read the backing field.
    return getattr(op, "_condition", None) is not None


def _qiskit_gates(b: _Builder, name: str, qubits: list[int], angles: list[Angle], idx: int, line) -> None:
    if name in _QISKIT_U:
        if name == "u2":
            th, ph, lam = _HALF_PI, angles[0], angles[1]
        else:
            th, ph, lam = angles
        q = qubits[0]
        b.emit("RZ", (q,), (lam,), idx, line)
        b.emit("RY", (q,), (th,), idx, line)
        b.emit("RZ", (q,), (ph,), idx, line)
        return
    ir_name = _QISKIT_DIRECT.get(name)
    if ir_name is None:
        raise IrError("unsupported_gate", f"gate '{name}' is not supported by the Trainability Lab")
    b.emit(ir_name, qubits, tuple(angles), idx, line)


def from_qiskit(circuit: Any, line_map: GateLineMap | None = None) -> ParamCircuit:
    """Convert a Qiskit ``QuantumCircuit`` (free parameters allowed)."""
    n = circuit.num_qubits
    _check_width(n)
    b = _Builder(n, "qiskit", [p.name for p in circuit.parameters])
    measured: set[int] = set()
    n_meas = n_barrier = 0
    for idx, inst in enumerate(circuit.data):
        op = inst.operation
        qubits = [circuit.find_bit(q).index for q in inst.qubits]
        name = op.name
        if _is_conditioned(op):
            raise IrError("unsupported_gate", f"classically conditioned '{name}' is not supported")
        if name == "barrier":
            n_barrier += 1
            continue
        if name == "measure":
            n_meas += 1
            measured.update(qubits)
            continue
        if name == "reset":
            raise IrError("unsupported_gate", "reset is not supported (non-unitary)")
        if measured.intersection(qubits):
            raise IrError(
                "mid_circuit_measurement",
                f"gate '{name}' acts on a qubit after it was measured; mid-circuit measurement is not supported",
            )
        angles = [_qiskit_angle(p) for p in op.params]
        line = line_map.qiskit_line(circuit, idx) if line_map else None
        _qiskit_gates(b, name, qubits, angles, idx, line)
    b.note_dropped("measurement", n_meas)
    b.note_dropped("barrier", n_barrier)
    return b.build()


# -------------------------------------------------------------------- Cirq


def _cirq_linear(expr: Any) -> Angle:
    """Exponent (number or linear sympy expression) as ``coeff*sym + offset``."""
    import sympy

    if not isinstance(expr, sympy.Basic):
        return float(expr)
    free = sorted(expr.free_symbols, key=str)
    if not free:
        return float(expr)
    if len(free) > 1:
        raise IrError("nonlinear_parameter", f"exponent '{expr}' depends on several symbols")
    sym = free[0]
    d = sympy.diff(expr, sym)
    if d.free_symbols:
        raise IrError("nonlinear_parameter", f"exponent '{expr}' is not linear in {sym}")
    return ParamRef(str(sym), float(d), float(expr.subs(sym, 0)))


def _is_number(a: Angle) -> bool:
    return not isinstance(a, ParamRef)


_CIRQ_FIXED_Z = {0.5: "S", -0.5: "SDG", 0.25: "T", -0.25: "TDG", 1.0: "Z"}


def _cirq_gates(b: _Builder, cirq: Any, gate: Any, qubits: list[int], idx: int, line) -> bool:
    """Emit IR for ``gate``; returns False for dropped (global phase) gates."""
    unsupported = IrError("unsupported_gate", f"gate '{gate}' is not supported by the Trainability Lab")
    if isinstance(gate, cirq.GlobalPhaseGate):
        return False
    if isinstance(gate, cirq.IdentityGate):
        for q in qubits:
            b.emit("I", (q,), (), idx, line)
        return True
    if isinstance(gate, cirq.CSwapGate):
        b.emit("CSWAP", qubits, (), idx, line)
        return True
    if isinstance(gate, (cirq.XPowGate, cirq.YPowGate, cirq.ZPowGate)) and len(qubits) == 1:
        letter = "X" if isinstance(gate, cirq.XPowGate) else "Y" if isinstance(gate, cirq.YPowGate) else "Z"
        t = _cirq_linear(gate.exponent)
        if _is_number(t):
            if t == 1.0:
                b.emit(letter, qubits, (), idx, line)
                return True
            if letter == "Z" and t in _CIRQ_FIXED_Z:
                b.emit(_CIRQ_FIXED_Z[t], qubits, (), idx, line)
                return True
            if t == 0.0:
                b.emit("I", qubits, (), idx, line)
                return True
        b.emit(f"R{letter}", qubits, (_scale(t, math.pi),), idx, line)
        return True
    if isinstance(gate, cirq.HPowGate) and len(qubits) == 1:
        if gate.exponent == 1:
            b.emit("H", qubits, (), idx, line)
            return True
        raise unsupported
    if isinstance(gate, cirq.CZPowGate):
        t = _cirq_linear(gate.exponent)
        if _is_number(t) and t == 1.0:
            b.emit("CZ", qubits, (), idx, line)
        else:
            b.emit("CP", qubits, (_scale(t, math.pi),), idx, line)
        return True
    if isinstance(gate, cirq.CXPowGate):
        t = _cirq_linear(gate.exponent)
        if _is_number(t) and t == 1.0:
            b.emit("CX", qubits, (), idx, line)
        else:
            # CX**t = P_control(pi t / 2) . CRX(pi t)   (X**t = e^{i pi t/2} RX(pi t))
            b.emit("CRX", qubits, (_scale(t, math.pi),), idx, line)
            b.emit("P", (qubits[0],), (_scale(t, math.pi / 2),), idx, line)
        return True
    pair = {cirq.XXPowGate: "RXX", cirq.YYPowGate: "RYY", cirq.ZZPowGate: "RZZ"}
    for cls, ir_name in pair.items():
        if isinstance(gate, cls):
            b.emit(ir_name, qubits, (_scale(_cirq_linear(gate.exponent), math.pi),), idx, line)
            return True
    fixed = (
        (cirq.SwapPowGate, "SWAP"), (cirq.ISwapPowGate, "ISWAP"),
        (cirq.CCXPowGate, "CCX"), (cirq.CCZPowGate, "CCZ"),
    )
    for cls, ir_name in fixed:
        if isinstance(gate, cls):
            if cirq.is_parameterized(gate) or gate.exponent != 1:
                raise unsupported
            b.emit(ir_name, qubits, (), idx, line)
            return True
    raise unsupported


def from_cirq(circuit: Any, line_map: GateLineMap | None = None) -> ParamCircuit:
    """Convert a Cirq ``Circuit`` (symbolic exponents allowed)."""
    import cirq

    all_qubits = sorted(circuit.all_qubits())
    n = len(all_qubits)
    _check_width(n)
    index = {q: i for i, q in enumerate(all_qubits)}
    b = _Builder(n, "cirq", sorted(cirq.parameter_names(circuit)))
    measured: set[int] = set()
    n_meas = n_phase = 0
    idx = -1
    for moment in circuit.moments:
        for op in moment.operations:
            idx += 1
            gate = op.gate
            if gate is None:
                raise IrError("unsupported_gate", f"operation '{op}' has no gate and is not supported")
            qubits = [index[q] for q in op.qubits]
            if isinstance(gate, cirq.MeasurementGate):
                n_meas += 1
                measured.update(qubits)
                continue
            if measured.intersection(qubits):
                raise IrError(
                    "mid_circuit_measurement",
                    f"gate '{gate}' acts on a qubit after it was measured; mid-circuit measurement is not supported",
                )
            line = line_map.cirq_line(op) if line_map else None
            if not _cirq_gates(b, cirq, gate, qubits, idx, line):
                n_phase += 1
    b.note_dropped("measurement", n_meas)
    b.note_dropped("global phase gate", n_phase)
    return b.build()


# ---------------------------------------------------------------- dispatch


def from_object(obj: Any, line_map: GateLineMap | None = None) -> ParamCircuit:
    """Dispatch on the circuit type; raises ``IrError("unsupported_object")``."""
    if isinstance(obj, ParamCircuit):
        return obj
    if isinstance(obj, dict):
        return ParamCircuit.from_json(obj)
    try:
        from qiskit import QuantumCircuit

        if isinstance(obj, QuantumCircuit):
            return from_qiskit(obj, line_map)
    except ImportError:
        pass
    try:
        import cirq

        if isinstance(obj, cirq.Circuit):
            return from_cirq(obj, line_map)
        if isinstance(obj, cirq.FrozenCircuit):
            return from_cirq(obj.unfreeze(), line_map)
    except ImportError:
        pass
    raise IrError("unsupported_object", f"cannot convert object of type {type(obj).__name__}")
