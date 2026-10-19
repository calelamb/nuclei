"""Compile a rotation program into pure Pauli rotations by pushing Cliffords to the end.

If ``V_k`` is the product of the Clifford gates that precede rotation ``k`` in time, then
``R_k(P) V_k = V_k R_k(V_k† P V_k)``.  Moving every Clifford to the end of the circuit gives::

    U = V_final · R'_m ... R'_1,        P'_k = V_k† P_k V_k,

and ``C = <0|U† O U|0> = <0| R'_1† ... R'_m† (V_final† O V_final) R'_m ... R'_1 |0>``.
So the observable is conjugated once and every rotation carries a (signed) conjugated Pauli.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

from ._ppe_types import CliffordGate, PauliRotation, RotationProgram
from ._symplectic_frame import CliffordFrame
from .symplectic import WORD_BITS, PauliArray, n_words

_LETTER = {"X": (1, 0), "Z": (0, 1), "Y": (1, 1)}
_MASK64 = (1 << 64) - 1


def ops_to_ints(ops, n_qubits: int) -> tuple[int, int]:
    """Bit-string ints ``(x, z)`` of a sparse op tuple (validated)."""
    x = z = 0
    for q, letter in ops:
        q = int(q)
        letter = letter.upper()
        if letter == "I":
            continue
        if letter not in _LETTER or not 0 <= q < n_qubits:
            raise ValueError(f"bad Pauli op {(q, letter)!r} for n_qubits={n_qubits}")
        if ((x | z) >> q) & 1:
            raise ValueError(f"duplicate qubit {q} in {ops!r}")
        xb, zb = _LETTER[letter]
        x |= xb << q
        z |= zb << q
    return x, z


def ints_to_words(v: int, n_w: int) -> np.ndarray:
    return np.array([(v >> (WORD_BITS * w)) & _MASK64 for w in range(n_w)], dtype=np.uint64)


@dataclass(frozen=True)
class CompiledProgram:
    n_qubits: int
    rot_x: np.ndarray       # (R, W) uint64, time order
    rot_z: np.ndarray
    rot_sign: np.ndarray    # (R,) +-1.0
    rot_param: np.ndarray   # (R,) int
    rot_freq: np.ndarray    # (R,) float
    union_before: np.ndarray  # (R+1, W): OR of supports of rotations with index < j
    obs: PauliArray         # (K,) Hermitian, phase 0 (sign folded into obs_w)
    obs_w: np.ndarray       # (K,) float

    @property
    def n_rot(self) -> int:
        return int(self.rot_x.shape[0])


def compile_program(program: RotationProgram, n_qubits: int, n_params: int | None,
                    observable: Sequence[tuple[float, tuple]]) -> CompiledProgram:
    n_w = n_words(n_qubits)
    frame = CliffordFrame(n_qubits)
    rx, rz, rs, rp, rf = [], [], [], [], []
    for gate in program:
        if isinstance(gate, CliffordGate):
            frame.append(gate.name, gate.qubits)
        elif isinstance(gate, PauliRotation):
            freq = int(gate.freq)
            if freq != gate.freq or freq == 0:
                raise ValueError("PauliRotation.freq must be a nonzero integer")
            if n_params is not None and not 0 <= gate.param < n_params:
                raise ValueError(f"parameter index {gate.param} out of range")
            x, z = ops_to_ints(gate.ops, n_qubits)
            if x == 0 and z == 0:
                raise ValueError("PauliRotation with identity generator")
            x2, z2, s = frame.map_string(x, z)
            rx.append(ints_to_words(x2, n_w))
            rz.append(ints_to_words(z2, n_w))
            rs.append(float(s))
            rp.append(int(gate.param))
            rf.append(float(freq))
        else:
            raise TypeError(f"unknown program element {gate!r}")
    r = len(rs)
    rot_x = np.array(rx, dtype=np.uint64).reshape(r, n_w)
    rot_z = np.array(rz, dtype=np.uint64).reshape(r, n_w)
    union = np.zeros((r + 1, n_w), dtype=np.uint64)
    if r:
        union[1:] = np.bitwise_or.accumulate(rot_x | rot_z, axis=0)
    terms: dict[tuple[int, int], float] = {}
    for coeff, ops in observable:
        x, z = ops_to_ints(ops, n_qubits)
        x2, z2, s = frame.map_string(x, z)
        terms[(x2, z2)] = terms.get((x2, z2), 0.0) + s * float(coeff)
    if not all(math.isfinite(v) for v in terms.values()):
        raise ValueError("observable coefficients must be finite")
    items = [(k, v) for k, v in terms.items() if v != 0.0]
    obs = PauliArray.identity(n_qubits, len(items))
    for i, ((x, z), _) in enumerate(items):
        obs.x[i], obs.z[i] = ints_to_words(x, n_w), ints_to_words(z, n_w)
    return CompiledProgram(n_qubits, rot_x, rot_z, np.array(rs), np.array(rp, dtype=np.int64),
                           np.array(rf), union, obs, np.array([v for _, v in items], dtype=float))
