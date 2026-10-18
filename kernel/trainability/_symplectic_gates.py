"""Clifford gate conjugation tables (helper for ``symplectic.py``).

For every supported Clifford ``g`` we need the Heisenberg map ``P -> g† P g`` on
Hermitian Pauli strings.  Rather than hand-copying sign rules (error prone) the
tables are *derived at import time from the dense gate matrices*: for every
Pauli ``P`` on the gate's 1 or 2 qubits we compute ``g† P g`` numerically and
read off the unique Hermitian Pauli ``±P'`` it equals.  The resulting tables are
tiny (4 or 16 rows) and are applied to whole batches by integer gathers.

Local bit layout of a table index (qubit ``a`` is the first gate operand, e.g.
the control of CX): ``idx = xa | za << 1 | xb << 2 | zb << 3``.

Stim is the independent oracle: ``test_trainability_symplectic`` checks that the
native tables agree with ``stim.Tableau`` on random circuits.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np

_R = 1 / math.sqrt(2)
_I2 = np.eye(2, dtype=complex)
_X = np.array([[0, 1], [1, 0]], dtype=complex)
_Y = np.array([[0, -1j], [1j, 0]], dtype=complex)
_Z = np.array([[1, 0], [0, -1]], dtype=complex)
_H = _R * np.array([[1, 1], [1, -1]], dtype=complex)
_S = np.diag([1, 1j]).astype(complex)
_SX = 0.5 * np.array([[1 + 1j, 1 - 1j], [1 - 1j, 1 + 1j]], dtype=complex)

_P0 = np.diag([1, 0]).astype(complex)
_P1 = np.diag([0, 1]).astype(complex)


def _controlled(u: np.ndarray) -> np.ndarray:
    return np.kron(_P0, _I2) + np.kron(_P1, u)


_GATE_MATRICES: dict[str, np.ndarray] = {
    "I": _I2,
    "H": _H,
    "S": _S,
    "SDG": _S.conj().T,
    "X": _X,
    "Y": _Y,
    "Z": _Z,
    "SX": _SX,
    "SXDG": _SX.conj().T,
    "CX": _controlled(_X),
    "CY": _controlled(_Y),
    "CZ": _controlled(_Z),
    "SWAP": np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=complex),
    "ISWAP": np.array([[1, 0, 0, 0], [0, 0, 1j, 0], [0, 1j, 0, 0], [0, 0, 0, 1]], dtype=complex),
}

#: Alias -> canonical name.
ALIASES: dict[str, str] = {
    "SQRT_X": "SX",
    "SQRTX": "SX",
    "SQRT_X_DAG": "SXDG",
    "S_DAG": "SDG",
    "SDAG": "SDG",
    "CNOT": "CX",
    "ID": "I",
}

#: Stim names for the supported gates.
STIM_NAMES: dict[str, str] = {
    "I": "I", "H": "H", "S": "S", "SDG": "S_DAG", "X": "X", "Y": "Y", "Z": "Z",
    "SX": "SQRT_X", "SXDG": "SQRT_X_DAG", "CX": "CX", "CY": "CY", "CZ": "CZ",
    "SWAP": "SWAP", "ISWAP": "ISWAP",
}

SUPPORTED: frozenset[str] = frozenset(_GATE_MATRICES)
SUPPORTED_NAMES = SUPPORTED


def canonical_name(name: str) -> str:
    key = name.strip().upper()
    key = ALIASES.get(key, key)
    if key not in _GATE_MATRICES:
        raise ValueError(f"unsupported Clifford gate {name!r}")
    return key


def arity(name: str) -> int:
    return 1 if canonical_name(name) in _ONE_QUBIT else 2


_ONE_QUBIT = frozenset({"I", "H", "S", "SDG", "X", "Y", "Z", "SX", "SXDG"})


def _pauli_matrix(x: int, z: int) -> np.ndarray:
    return (((_I2, _Z), (_X, _Y))[x][z])


def _local_pauli(bits: Sequence[int]) -> np.ndarray:
    """Kron of Hermitian Paulis from bits ``(xa, za[, xb, zb])``."""
    mat = _pauli_matrix(bits[0], bits[1])
    if len(bits) == 4:
        mat = np.kron(mat, _pauli_matrix(bits[2], bits[3]))
    return mat


@dataclass(frozen=True)
class GateTable:
    """Lookup of ``g† P g``: ``out_bits[idx]`` is the output index, ``flip[idx]`` the sign flip."""

    arity: int
    out_idx: np.ndarray  # (4**arity,) intp, output table index
    flip: np.ndarray     # (4**arity,) uint8, 1 if the output carries a minus sign


def _build_table(name: str) -> GateTable:
    mat = _GATE_MATRICES[name]
    k = 1 if name in _ONE_QUBIT else 2
    size = 4 ** k
    out_idx = np.zeros(size, dtype=np.intp)
    flip = np.zeros(size, dtype=np.uint8)
    dim = 2 ** k
    for idx in range(size):
        bits = [(idx >> b) & 1 for b in range(2 * k)]
        conj = mat.conj().T @ _local_pauli(bits) @ mat
        found = False
        for j in range(size):
            obits = [(j >> b) & 1 for b in range(2 * k)]
            coef = np.trace(_local_pauli(obits).conj().T @ conj) / dim
            if abs(abs(coef) - 1.0) < 1e-9:
                if abs(coef.imag) > 1e-9:
                    raise AssertionError(f"{name}: non-Hermitian image")
                out_idx[idx] = j
                flip[idx] = 1 if coef.real < 0 else 0
                found = True
                break
        if not found:  # pragma: no cover - would mean a non-Clifford matrix
            raise AssertionError(f"{name} is not Clifford")
    return GateTable(k, out_idx, flip)


_TABLES: dict[str, GateTable] = {}


def gate_table(name: str) -> GateTable:
    key = canonical_name(name)
    table = _TABLES.get(key)
    if table is None:
        table = _build_table(key)
        _TABLES[key] = table
    return table


def local_generator_images(name: str) -> list[tuple[tuple[int, ...], int]]:
    """Images ``g† G g`` of the local generators ``X_a, Z_a[, X_b, Z_b]``.

    Returns, per generator, ``(bits, sign)`` with ``bits = (xa, za[, xb, zb])`` and
    ``sign`` in ``{+1, -1}``.
    """
    table = gate_table(name)
    k = table.arity
    images = []
    for gen in range(2 * k):
        idx = 1 << gen
        out = int(table.out_idx[idx])
        bits = tuple((out >> b) & 1 for b in range(2 * k))
        images.append((bits, -1 if table.flip[idx] else 1))
    return images


def _near_multiple(angle: float, base: float, tol: float = 1e-9) -> int | None:
    ratio = angle / base
    nearest = round(ratio)
    return int(nearest) % 4 if abs(ratio - nearest) < tol else None


def clifford_decomposition(name: str, angles: tuple[float, ...] = ()) -> tuple[str, ...] | None:
    """Time-ordered supported Clifford gate names equal (up to global phase) to the gate.

    Returns ``None`` if the gate is not Clifford.  ``RZ(kπ/2) ~ S^k``, ``P(kπ/2) ~ S^k``,
    ``RX(kπ/2) ~ SX^k`` and ``RY(π/2) ~ Z then H`` (so ``RY(kπ/2)`` is that, k times).
    """
    key = name.strip().upper()
    key = ALIASES.get(key, key)
    if key in _GATE_MATRICES:
        return (key,)
    if key in {"RZ", "P", "PHASE", "U1", "RX", "RY"} and len(angles) == 1:
        k = _near_multiple(float(angles[0]), math.pi / 2)
        if k is None:
            return None
        if key in {"RZ", "P", "PHASE", "U1"}:
            return ("S",) * k
        if key == "RX":
            return ("SX",) * k
        return ("Z", "H") * k
    return None


def is_clifford_gate(name: str, angles: tuple[float, ...] = ()) -> bool:
    """True for supported Cliffords and RZ/RX/RY/P at multiples of pi/2."""
    return clifford_decomposition(name, angles) is not None
