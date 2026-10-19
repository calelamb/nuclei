"""IR -> time-ordered elementary items (shared by the PPE adapter, the DLA and the linter).

Each IR gate becomes one or more items:

* :class:`Rotation` - a parameterized exponential ``exp(-i (a v + b) G)`` with
  ``G = Σ c_j P_j`` (identity terms dropped; they only add a global phase).  ``U(θ, φ, λ)``
  is expanded in *time order* ``RZ(λ), RY(θ), RZ(φ)`` (``U = e^{i(φ+λ)/2} RZ(φ) RY(θ) RZ(λ)``).
* :class:`FixedClifford` - a fixed Clifford (supported name sequence).
* :class:`FixedOther` - any other fixed gate (T, CH, CCX, a constant non-Clifford angle...).
"""

from __future__ import annotations

from dataclasses import dataclass

from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import IrGate, ParamCircuit, ParamRef
from kernel.trainability.symplectic import clifford_decomposition, clifford_sequence

Ops = tuple[tuple[int, str], ...]


@dataclass(frozen=True)
class Rotation:
    gate_index: int
    gate_name: str
    qubits: tuple[int, ...]
    ref: ParamRef
    terms: tuple[tuple[float, Ops], ...]   # non-identity generator terms


@dataclass(frozen=True)
class FixedClifford:
    gate_index: int
    gate_name: str
    qubits: tuple[int, ...]
    names: tuple[str, ...]                 # time-ordered supported Clifford names (may be empty)


@dataclass(frozen=True)
class FixedOther:
    gate_index: int
    gate_name: str
    qubits: tuple[int, ...]
    angles: tuple[float, ...]


Item = Rotation | FixedClifford | FixedOther


def _generator_terms(gate_name: str, qubits: tuple[int, ...]) -> tuple[tuple[float, Ops], ...]:
    gen = GATE_SPECS[gate_name].generator(qubits)
    return tuple((float(t.coeff), t.ops) for t in gen.terms if t.ops)


def _fixed_for(index: int, name: str, qubits: tuple[int, ...], angles: tuple[float, ...]) -> list[Item]:
    """A constant-angle gate: nothing if trivial, Clifford item(s) if a quarter turn, else 'other'.

    Two-qubit rotations at ``kπ/2`` (RZZ/RXX/RYY/RZX) lower to several Clifford items (CX, S, H, ...),
    each on its own qubit subset."""
    if angles[0] == 0.0 and GATE_SPECS[name].generator is not None:
        return []  # exp(-i 0 G) = identity
    steps = clifford_sequence(name, angles)
    if steps is not None:
        grouped: list[tuple[tuple[int, ...], list[str]]] = []
        for nm, loc in steps:                      # merge consecutive steps on the same operands
            if grouped and grouped[-1][0] == loc:
                grouped[-1][1].append(nm)
            else:
                grouped.append((loc, [nm]))
        return [FixedClifford(index, name, tuple(qubits[i] for i in loc), tuple(nms)) for loc, nms in grouped]
    return [FixedOther(index, name, qubits, angles)]


def _walk_gate(index: int, g: IrGate) -> list[Item]:
    spec = GATE_SPECS[g.name]
    if spec.n_angles == 0:
        names = clifford_decomposition(g.name, ()) if spec.clifford else None
        if names is not None:
            return [FixedClifford(index, g.name, g.qubits, tuple(names))]
        return [FixedOther(index, g.name, g.qubits, ())]
    if g.name == "U":
        theta, phi, lam = g.angles
        q = g.qubits
        out: list[Item] = []
        for name, angle in (("RZ", lam), ("RY", theta), ("RZ", phi)):
            out.extend(_one_angle(index, name, q, angle))
        return out
    return _one_angle(index, g.name, g.qubits, g.angles[0])


def _one_angle(index: int, name: str, qubits: tuple[int, ...], angle) -> list[Item]:
    if isinstance(angle, ParamRef):
        return [Rotation(index, name, qubits, angle, _generator_terms(name, qubits))]
    return _fixed_for(index, name, qubits, (float(angle),))


def walk(circuit: ParamCircuit) -> list[Item]:
    """Time-ordered elementary items of ``circuit``."""
    items: list[Item] = []
    for i, g in enumerate(circuit.gates):
        items.extend(_walk_gate(i, g))
    return items


def source_key(circuit: ParamCircuit, gate_index: int) -> int:
    """The gate's ``source_index`` (falls back to its position in ``circuit.gates``)."""
    si = circuit.gates[gate_index].source_index
    return gate_index if si is None else si
