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
* Composite instructions (library circuits, user sub-circuit blocks, ``CircuitOperation``...) are
  expanded to a fixed point, at most ``MAX_DECOMPOSE_LEVELS`` deep (``_decompose``); every gate a
  composite expands to shares the composite's ``source_index``, and the level is reported in ``notes``.
"""

from __future__ import annotations

import math
from typing import Any

from kernel.trainability._decompose import (
    MAX_DECOMPOSE_LEVELS,
    DecompositionLog,
    cirq_decompose_once,
    decompose_enabled,
    is_composite_cirq,
    qiskit_leaves,
    too_deep,
)
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
# Names the converter handles itself; everything else that is a composite block is decomposed.
_QISKIT_KNOWN = frozenset(_QISKIT_DIRECT) | _QISKIT_U | {"barrier", "measure", "reset"}
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
    offset = p.assign(param, 0.0)
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


class _QiskitState:
    """Per-conversion bookkeeping for :func:`from_qiskit`."""

    def __init__(self, builder: _Builder) -> None:
        self.b = builder
        self.measured: set[int] = set()
        self.n_meas = self.n_barrier = 0
        self.log = DecompositionLog()

    def lower_leaf(self, op: Any, qubits: list[int], idx: int, line, depth: int, top: str) -> None:
        name = op.name
        inside = f" (inside composite '{top}')" if depth else ""
        if _is_conditioned(op):
            raise IrError("unsupported_gate", f"classically conditioned '{name}' is not supported{inside}")
        if name == "barrier":
            self.n_barrier += 0 if depth else 1
            return
        if name == "measure":
            if depth:
                raise IrError("unsupported_gate", f"measurement inside composite '{top}' is not supported")
            self.n_meas += 1
            self.measured.update(qubits)
            return
        if name == "reset":
            raise IrError("unsupported_gate", f"reset is not supported (non-unitary){inside}")
        if name not in _QISKIT_KNOWN:
            raise IrError("unsupported_gate", f"gate '{name}' is not supported by the Trainability Lab{inside}")
        if self.measured.intersection(qubits):
            raise IrError(
                "mid_circuit_measurement",
                f"gate '{name}' acts on a qubit after it was measured; mid-circuit measurement is not supported",
            )
        angles = [_qiskit_angle(p) for p in op.params]
        _qiskit_gates(self.b, name, qubits, angles, idx, line)


def from_qiskit(circuit: Any, line_map: GateLineMap | None = None, *, decompose: bool | None = None) -> ParamCircuit:
    """Convert a Qiskit ``QuantumCircuit`` (free parameters allowed).

    ``decompose=None`` follows ``NUCLEI_IR_DECOMPOSE`` (on by default); ``False`` keeps the pre-PRD-15
    behaviour where a composite block is an unsupported gate.
    """
    expand = decompose_enabled(decompose)
    n = circuit.num_qubits
    _check_width(n)
    b = _Builder(n, "qiskit", [p.name for p in circuit.parameters])
    state = _QiskitState(b)
    for idx, inst in enumerate(circuit.data):
        op = inst.operation
        qubits = [circuit.find_bit(q).index for q in inst.qubits]
        if _is_conditioned(op):
            raise IrError("unsupported_gate", f"classically conditioned '{op.name}' is not supported")
        line = line_map.qiskit_line(circuit, idx) if line_map else None
        deepest = 0
        leaves = qiskit_leaves(op, qubits, _QISKIT_KNOWN) if expand else iter([(op, qubits, 0)])
        for leaf, leaf_qubits, depth in leaves:
            state.lower_leaf(leaf, leaf_qubits, idx, line, depth, op.name)
            deepest = max(deepest, depth)
        if deepest:
            state.log.record(op.name, deepest)
    b.note_dropped("measurement", state.n_meas)
    b.note_dropped("barrier", state.n_barrier)
    b.notes.extend(state.log.notes())
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


class _CirqState:
    """Per-conversion bookkeeping for :func:`from_cirq`."""

    def __init__(self, cirq: Any, builder: _Builder, index: dict, expand: bool = True) -> None:
        self.cirq, self.b, self.index, self.expand = cirq, builder, index, expand
        self.measured: set[int] = set()
        self.n_meas = self.n_phase = 0
        self.log = DecompositionLog()

    def lower(self, op: Any, idx: int, line, depth: int = 0, top: str = "") -> int:
        """Lower ``op`` (decomposing composites); returns the deepest level used."""
        cirq, gate = self.cirq, op.gate
        composite = self.expand and is_composite_cirq(cirq, op)
        if gate is None and not composite:
            raise IrError("unsupported_gate", f"operation '{op}' has no gate and is not supported")
        qubits = [self.index[q] for q in op.qubits]
        if isinstance(gate, cirq.MeasurementGate):
            if depth:
                raise IrError("unsupported_gate", f"measurement inside composite '{top}' is not supported")
            self.n_meas += 1
            self.measured.update(qubits)
            return depth
        if self.measured.intersection(qubits):
            raise IrError(
                "mid_circuit_measurement",
                f"gate '{gate}' acts on a qubit after it was measured; mid-circuit measurement is not supported",
            )
        if gate is not None:
            mark = len(self.b.gates)
            try:
                if not _cirq_gates(self.b, cirq, gate, qubits, idx, line):
                    self.n_phase += 1
                return depth
            except IrError as exc:
                if exc.code != "unsupported_gate" or not composite:
                    raise
                del self.b.gates[mark:]  # nothing is emitted before an unsupported verdict; belt and braces
        return self._expand(op, idx, line, depth, top or _cirq_name(op))

    def _expand(self, op: Any, idx: int, line, depth: int, top: str) -> int:
        if depth >= MAX_DECOMPOSE_LEVELS:
            raise too_deep(top)
        parts = cirq_decompose_once(self.cirq, op)
        if parts is None:
            raise IrError("unsupported_gate", f"gate '{op.gate or op}' is not supported by the Trainability Lab")
        deepest = depth + 1
        for part in parts:
            deepest = max(deepest, self.lower(part, idx, line, depth + 1, top))
        return deepest


def _cirq_name(op: Any) -> str:
    return type(op.gate).__name__ if op.gate is not None else type(op).__name__


def from_cirq(circuit: Any, line_map: GateLineMap | None = None, *, decompose: bool | None = None) -> ParamCircuit:
    """Convert a Cirq ``Circuit`` (symbolic exponents allowed); ``decompose`` as in :func:`from_qiskit`."""
    import cirq

    all_qubits = sorted(circuit.all_qubits())
    n = len(all_qubits)
    _check_width(n)
    index = {q: i for i, q in enumerate(all_qubits)}
    b = _Builder(n, "cirq", sorted(cirq.parameter_names(circuit)))
    state = _CirqState(cirq, b, index, decompose_enabled(decompose))
    idx = -1
    for moment in circuit.moments:
        for op in moment.operations:
            idx += 1
            line = line_map.cirq_line(op) if line_map else None
            deepest = state.lower(op, idx, line)
            if deepest:
                state.log.record(_cirq_name(op), deepest)
    b.note_dropped("measurement", state.n_meas)
    b.note_dropped("global phase gate", state.n_phase)
    b.notes.extend(state.log.notes())
    return b.build()


# ---------------------------------------------------------------- dispatch


def from_object(obj: Any, line_map: GateLineMap | None = None, *, decompose: bool | None = None) -> ParamCircuit:
    """Dispatch on the circuit type; raises ``IrError("unsupported_object")``."""
    if isinstance(obj, ParamCircuit):
        return obj
    if isinstance(obj, dict):
        return ParamCircuit.from_json(obj)
    try:
        from qiskit import QuantumCircuit

        if isinstance(obj, QuantumCircuit):
            return from_qiskit(obj, line_map, decompose=decompose)
    except ImportError:
        pass
    try:
        import cirq

        if isinstance(obj, cirq.Circuit):
            return from_cirq(obj, line_map, decompose=decompose)
        if isinstance(obj, cirq.FrozenCircuit):
            return from_cirq(obj.unfreeze(), line_map, decompose=decompose)
    except ImportError:
        pass
    raise IrError("unsupported_object", f"cannot convert object of type {type(obj).__name__}")
