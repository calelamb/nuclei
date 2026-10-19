"""IR-level optimization passes of the Lab Compiler (spec section 4.1.1).

Pipeline (see ``compiler.compile_circuit``):

1. :func:`canonicalize` - IR gates to ``CGate`` with linear angles over
   *parameter indices*; ``U(t, p, l)`` becomes ``RZ(l) RY(t) RZ(p)`` and its
   global phase ``(p + l) / 2`` is tracked separately so ``states`` stay
   exactly equal to the reference oracle.
2. :func:`merge_rotations` - adjacent same-axis RX / RY on one wire add their
   linear angles (same ``ParamRef`` or constants).
3. :func:`fuse_fixed_1q` - consecutive fixed single-qubit gates on a wire
   multiply into one 2x2 matrix.
4. :func:`clifford_segments` - maximal Clifford runs (for Pauli propagation).

Diagonal-run and monomial fusion happen during lowering (``compiler.py``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from kernel.trainability.gates import GATE_SPECS
from kernel.trainability.ir import ParamCircuit, ParamRef
from kernel.trainability.ops import LinAngle

__all__ = ["CGate", "Mat1", "canonicalize", "merge_rotations", "fuse_fixed_1q", "clifford_segments"]

_CLIFFORD_QUARTER_TURNS = ("RX", "RY", "RZ", "P")


@dataclass(frozen=True, eq=False)
class CGate:
    """Canonical gate; ``angle`` is ``None`` for fixed gates."""

    name: str
    qubits: tuple[int, ...]
    angle: LinAngle | None = None


@dataclass(frozen=True, eq=False)
class Mat1:
    """Fused fixed single-qubit matrix."""

    qubit: int
    matrix: np.ndarray

    @property
    def qubits(self) -> tuple[int, ...]:
        return (self.qubit,)


def _lin(angle: float | ParamRef, index: dict[str, int]) -> LinAngle:
    if isinstance(angle, ParamRef):
        return LinAngle(
            np.array([index[angle.name]], dtype=np.int64),
            np.array([angle.coeff], dtype=float),
            float(angle.offset),
        )
    return LinAngle.constant(float(angle))


def canonicalize(circuit: ParamCircuit) -> tuple[list[CGate], LinAngle]:
    """Return canonical gates and the (possibly parametric) global phase."""
    index = circuit.param_index()
    out: list[CGate] = []
    phase = LinAngle.constant(0.0)
    for g in circuit.gates:
        angles = [_lin(a, index) for a in g.angles]
        if g.name == "U":
            theta, phi, lam = angles
            q = g.qubits
            out += [CGate("RZ", q, lam), CGate("RY", q, theta), CGate("RZ", q, phi)]
            phase = phase.plus(phi.scaled(0.5)).plus(lam.scaled(0.5))
        else:
            out.append(CGate(g.name, g.qubits, angles[0] if angles else None))
    return out, phase


def merge_rotations(gates: list[CGate]) -> tuple[list[CGate], int]:
    """Merge adjacent same-axis RX/RY on a wire; returns (gates, merges)."""
    out: list[CGate] = []
    last: dict[int, int] = {}
    merged = 0
    for g in gates:
        if g.name in ("RX", "RY"):
            j = last.get(g.qubits[0])
            if j is not None and out[j].name == g.name and len(out[j].qubits) == 1:
                out[j] = CGate(g.name, g.qubits, out[j].angle.plus(g.angle))
                merged += 1
                continue
        out.append(g)
        for q in g.qubits:
            last[q] = len(out) - 1
    return out, merged


def _fixed_1q_matrix(g: CGate) -> np.ndarray | None:
    spec = GATE_SPECS[g.name]
    if spec.arity != 1:
        return None
    if spec.n_angles == 0:
        return spec.matrix(())
    if g.angle is not None and g.angle.is_constant:
        return spec.matrix((g.angle.offset,))
    return None


def fuse_fixed_1q(gates: list[CGate]) -> tuple[list[CGate | Mat1], int]:
    """Fuse runs of fixed single-qubit gates per wire; returns (items, absorbed)."""
    out: list[CGate | Mat1] = []
    pending: dict[int, tuple[np.ndarray, int]] = {}
    absorbed = 0

    def flush(q: int) -> None:
        mat, _ = pending.pop(q)
        out.append(Mat1(q, mat))

    for g in gates:
        m = _fixed_1q_matrix(g)
        if m is not None:
            q = g.qubits[0]
            if q in pending:
                prev, count = pending[q]
                pending[q] = (m @ prev, count + 1)
                absorbed += 1
            else:
                pending[q] = (m, 1)
            continue
        for q in g.qubits:
            if q in pending:
                flush(q)
        out.append(g)
    for q in sorted(pending):
        flush(q)
    return out, absorbed


def _is_clifford(g: CGate) -> bool:
    spec = GATE_SPECS[g.name]
    if spec.n_angles == 0:
        return spec.clifford
    if g.name in _CLIFFORD_QUARTER_TURNS and g.angle is not None and g.angle.is_constant:
        turns = g.angle.offset / (math.pi / 2)
        return abs(turns - round(turns)) < 1e-12
    return False


def clifford_segments(gates: list[CGate]) -> tuple[tuple[int, int], ...]:
    """Maximal runs ``[start, stop)`` of Clifford gates in the canonical list."""
    segs: list[tuple[int, int]] = []
    start: int | None = None
    for i, g in enumerate(gates):
        if _is_clifford(g):
            if start is None:
                start = i
        elif start is not None:
            segs.append((start, i))
            start = None
    if start is not None:
        segs.append((start, len(gates)))
    return tuple(segs)
