"""Lowering of canonical items to kernel ops (diagonal + monomial fusion).

Diagonal-run fusion: consecutive diagonal gates on any qubits (a gate may
slide past gates on disjoint qubits, which it commutes with) collapse into a
single op ``psi <- psi * exp(i (phi0 + sum_j v_j hp_j))``.  For a parametric
diagonal gate ``exp(-i theta G)`` with diagonal generator eigenvalues
``g(x)`` the phase is ``-theta g(x)``; the per-parameter vectors ``hp_j``
accumulate ``-coeff * g`` over all gates that reference ``v_j``, so a whole
QAOA cost layer is one elementwise exponential.

Monomial fusion: fixed gates that permute basis states with phases (X, Y,
CX, CY, SWAP, ISWAP, CCX, CSWAP, fixed diagonals) compose into one gather
``out[y] = ph[y] * in[src[y]]``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Union

import numpy as np

from kernel.trainability.gates import GATE_SPECS, _pauli_string_matrix
from kernel.trainability.ops import DenseOp, DiagOp, LinAngle, MonoOp, Op, RotOp
from kernel.trainability.passes import CGate, Mat1
from kernel.trainability.pauli import PauliSum, basis_parity, term_masks

__all__ = ["lower_items", "MONO_MAX_QUBITS", "DIAG_MAX_BYTES"]

Item = Union[CGate, Mat1]

#: Above this width, monomial gates stay dense (gather tables cost 20 B/amplitude each).
MONO_MAX_QUBITS = 18
#: Cap on the K x 2^n float table of one fused diagonal op.
DIAG_MAX_BYTES = 256 << 20
_TOL = 1e-12


def _matrix_of(item: Item) -> np.ndarray | None:
    """Fixed matrix of ``item`` (or ``None`` for parametric gates)."""
    if isinstance(item, Mat1):
        return item.matrix
    spec = GATE_SPECS[item.name]
    if spec.n_angles == 0:
        return spec.matrix(())
    if item.angle is not None and item.angle.is_constant:
        return spec.matrix((item.angle.offset,))
    return None


def _is_diagonal_matrix(m: np.ndarray) -> bool:
    return bool(np.abs(m - np.diag(np.diag(m))).max() < _TOL)


def _is_diag_item(item: Item) -> bool:
    if isinstance(item, Mat1):
        return _is_diagonal_matrix(item.matrix)
    spec = GATE_SPECS[item.name]
    if spec.diagonal:
        return True
    m = _matrix_of(item)
    return m is not None and spec.arity > 1 and _is_diagonal_matrix(m)


def _local_index(n: int, qubits: tuple[int, ...]) -> np.ndarray:
    idx = np.arange(1 << n, dtype=np.int64)
    loc = np.zeros_like(idx)
    for j, q in enumerate(qubits):
        loc |= ((idx >> q) & 1) << j
    return loc


def generator_vector(ps: PauliSum, n: int) -> np.ndarray:
    """Eigenvalues of a Z-type Pauli sum over the computational basis."""
    g = np.zeros(1 << n)
    for t in ps.terms:
        xmask, zmask, _ = term_masks(t)
        if xmask:
            raise ValueError("generator of a diagonal gate must be Z-type")
        g += t.coeff * basis_parity(n, zmask)
    return g


class DiagAcc:
    """Accumulator for one fused diagonal op."""

    def __init__(self, n: int) -> None:
        self.n = n
        self.qubits: set[int] = set()
        self.phi0 = np.zeros(1 << n)
        self.hp: dict[int, np.ndarray] = {}
        self.count = 0

    def needs_flush_for(self, item: Item) -> bool:
        if not isinstance(item, CGate) or item.angle is None:
            return False
        new = sum(1 for i in item.angle.idx.tolist() if i not in self.hp)
        return (len(self.hp) + new) * (8 << self.n) > DIAG_MAX_BYTES

    def add(self, item: Item) -> None:
        self.count += 1
        self.qubits.update(item.qubits)
        m = _matrix_of(item)
        if m is not None:  # fixed (or constant-angle) diagonal
            loc = _local_index(self.n, item.qubits)
            self.phi0 += np.angle(np.diag(m))[loc]
            return
        spec = GATE_SPECS[item.name]
        g = generator_vector(spec.generator(item.qubits), self.n)
        angle: LinAngle = item.angle
        self.phi0 -= angle.offset * g
        for i, c in zip(angle.idx.tolist(), angle.coeff.tolist()):
            self.hp[i] = self.hp.get(i, 0.0) - c * g

    def to_op(self) -> Op:
        if not self.hp:
            return MonoOp(None, np.exp(1j * self.phi0))
        keys = sorted(self.hp)
        return DiagOp(np.array(keys, dtype=np.int64), np.stack([self.hp[k] for k in keys]), self.phi0)


def mono_tables(n: int, qubits: tuple[int, ...], m: np.ndarray):
    """``(src, ph)`` for a monomial matrix on ``qubits`` or ``None``."""
    mag = np.abs(m)
    if not (np.all((mag > _TOL).sum(axis=0) == 1) and np.all((mag > _TOL).sum(axis=1) == 1)):
        return None
    cols = np.argmax(mag, axis=1)  # source local index for each output local index
    vals = m[np.arange(m.shape[0]), cols]
    loc = _local_index(n, qubits)
    src = np.arange(1 << n, dtype=np.int64)
    for j, q in enumerate(qubits):
        src = (src & ~(1 << q)) | (((cols[loc] >> j) & 1) << q)
    return src, vals[loc]


def _compose(a: MonoOp, b: MonoOp) -> MonoOp:
    """Apply ``a`` then ``b``: ``src = sa[sb]``, ``ph = pb * pa[sb]``."""
    if a.src is None:
        src = b.src
    elif b.src is None:
        src = a.src
    else:
        src = a.src[b.src]
    pa = None if a.ph is None else (a.ph if b.src is None else a.ph[b.src])
    ph = pa if b.ph is None else (b.ph if pa is None else b.ph * pa)
    return MonoOp(src, ph)


@lru_cache(maxsize=64)
def _rot_matrices(name: str) -> tuple[np.ndarray, np.ndarray]:
    nc, letters = GATE_SPECS[name].pauli_rotation
    pic = np.zeros((1 << nc, 1 << nc), dtype=np.complex128)
    pic[-1, -1] = 1.0
    kt = len(letters)
    a = np.kron(np.eye(1 << kt, dtype=np.complex128), pic)
    b = np.kron(_pauli_string_matrix(letters), pic)
    return a, b


def _lower_nondiag(item: Item, n: int) -> Op:
    m = _matrix_of(item)
    qubits = item.qubits
    if m is not None:
        if n <= MONO_MAX_QUBITS:
            tables = mono_tables(n, qubits, m)
            if tables is not None:
                return MonoOp(*tables)
        return DenseOp(qubits, n, m)
    a, b = _rot_matrices(item.name)
    return RotOp(qubits, n, a, b, item.angle)


def lower_items(items: list[Item], n: int) -> tuple[list[Op], dict[str, int]]:
    """Schedule + lower fused items; returns (ops, stats)."""
    ops: list[Op] = []
    acc: DiagAcc | None = None
    diag_gates = 0

    def flush() -> None:
        nonlocal acc, diag_gates
        if acc is not None:
            ops.append(acc.to_op())
            diag_gates += acc.count
            acc = None

    for item in items:
        if isinstance(item, Mat1) and np.allclose(item.matrix, np.eye(2), atol=1e-14):
            continue  # fused to the identity
        if _is_diag_item(item):
            if acc is not None and acc.needs_flush_for(item):
                flush()
            acc = acc or DiagAcc(n)
            acc.add(item)
            continue
        if acc is not None and acc.qubits.intersection(item.qubits):
            flush()
        ops.append(_lower_nondiag(item, n))
    flush()

    fused: list[Op] = []
    mono_fused = 0
    for op in ops:
        if isinstance(op, MonoOp) and fused and isinstance(fused[-1], MonoOp):
            fused[-1] = _compose(fused[-1], op)
            mono_fused += 1
        else:
            fused.append(op)
    return fused, {"diag_gates_fused": diag_gates, "mono_fused": mono_fused}
