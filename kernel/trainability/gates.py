"""Gate library for the parameterized-circuit IR.

Conventions
-----------
* ``matrix(angles)`` returns the ``2^k x 2^k`` unitary for a ``k``-qubit gate
  acting on ``IrGate.qubits = (q0, q1, ...)``.  **Local index bit j is gate
  qubit j** (little-endian, identical to Qiskit's gate matrices), so for
  ``CX`` with ``qubits=(control, target)`` the control is bit 0.
* ``generator(qubits)`` returns a :class:`PauliSum` ``G`` on the *actual*
  circuit qubits with ``U(theta) = exp(-i * theta * G)`` for single-angle
  parametric gates.  Identity components are kept (they carry the global
  phase for simulation); the DLA ignores them.
* Controlled rotations use ``G = Pi_c (x) P_t / 2`` with the projector
  ``Pi_c = (I - Z_c)/2``; ``CRZ`` gives ``Z_t/4 - Z_c Z_t/4`` as in the spec.

Deviation from the spec text: for the phase gates the spec lists
``G_P = (I - Z)/2`` and ``G_CP = (I - Z_c - Z_t + Z_c Z_t)/4``, but
``exp(-i theta (I-Z)/2) = diag(1, e^{-i theta}) = P(-theta)``.  To satisfy
``U(theta) = exp(-i theta G)`` for the standard ``P(theta) = diag(1,
e^{i theta})`` (the Qiskit matrix) we use the negated generators
``G_P = (Z - I)/2`` and ``G_CP = -(I - Z_c - Z_t + Z_c Z_t)/4``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np

from kernel.trainability.pauli import PauliSum, PauliTerm

__all__ = ["GateSpec", "GATE_SPECS", "gate_matrix", "SHIFT_4TERM_GATES"]

_I2 = np.eye(2, dtype=np.complex128)
_X = np.array([[0, 1], [1, 0]], dtype=np.complex128)
_Y = np.array([[0, -1j], [1j, 0]], dtype=np.complex128)
_Z = np.array([[1, 0], [0, -1]], dtype=np.complex128)
_PAULI = {"X": _X, "Y": _Y, "Z": _Z}


@dataclass(frozen=True)
class GateSpec:
    """Static description of one IR gate."""

    name: str
    arity: int
    n_angles: int
    matrix: Callable[[Sequence[float]], np.ndarray]
    generator: Callable[[Sequence[int]], PauliSum] | None = None
    diagonal: bool = False
    clifford: bool = False
    # (control_count, pauli letters on the targets) for exp(-i t Pi P / 2) gates.
    pauli_rotation: tuple[int, str] | None = None

    @property
    def parametric(self) -> bool:
        return self.n_angles > 0


# ------------------------------------------------------------ matrix helpers


def _controlled(u: np.ndarray, n_ctrl: int) -> np.ndarray:
    """Controlled-``u``; controls are the low ``n_ctrl`` local bits."""
    k = int(np.log2(u.shape[0]))
    dim = 1 << (n_ctrl + k)
    m = np.eye(dim, dtype=np.complex128)
    cmask = (1 << n_ctrl) - 1
    for tin in range(1 << k):
        for tout in range(1 << k):
            m[(tout << n_ctrl) | cmask, (tin << n_ctrl) | cmask] = u[tout, tin]
    return m


def _pauli_string_matrix(letters: str) -> np.ndarray:
    """Little-endian matrix of ``P_0 (x) ... `` where letters[j] acts on bit j."""
    out = np.eye(1, dtype=np.complex128)
    for letter in letters:  # later letters are higher bits
        out = np.kron(_PAULI[letter], out)
    return out


def _rot1(letter: str) -> Callable[[Sequence[float]], np.ndarray]:
    def f(a: Sequence[float]) -> np.ndarray:
        t = a[0] / 2
        return np.cos(t) * _I2 - 1j * np.sin(t) * _PAULI[letter]

    return f


def _rot2(letters: str) -> Callable[[Sequence[float]], np.ndarray]:
    p = _pauli_string_matrix(letters)
    eye = np.eye(4, dtype=np.complex128)

    def f(a: Sequence[float]) -> np.ndarray:
        t = a[0] / 2
        return np.cos(t) * eye - 1j * np.sin(t) * p

    return f


def _p_matrix(a: Sequence[float]) -> np.ndarray:
    return np.array([[1, 0], [0, np.exp(1j * a[0])]], dtype=np.complex128)


def _u_matrix(a: Sequence[float]) -> np.ndarray:
    th, ph, lam = a
    c, s = np.cos(th / 2), np.sin(th / 2)
    return np.array(
        [[c, -np.exp(1j * lam) * s], [np.exp(1j * ph) * s, np.exp(1j * (ph + lam)) * c]],
        dtype=np.complex128,
    )


def _fixed(m: np.ndarray) -> Callable[[Sequence[float]], np.ndarray]:
    mat = np.array(m, dtype=np.complex128)
    mat.setflags(write=False)

    def f(_a: Sequence[float]) -> np.ndarray:
        return mat.copy()

    return f


# ---------------------------------------------------------- generator helpers


def _t(coeff: float, *ops: tuple[int, str]) -> PauliTerm:
    return PauliTerm(coeff, tuple(sorted(ops)))


def _gen_rot1(letter: str) -> Callable[[Sequence[int]], PauliSum]:
    return lambda q: PauliSum((_t(0.5, (q[0], letter)),))


def _gen_rot2(letters: str) -> Callable[[Sequence[int]], PauliSum]:
    return lambda q: PauliSum((_t(0.5, (q[0], letters[0]), (q[1], letters[1])),))


def _gen_p(q: Sequence[int]) -> PauliSum:
    return PauliSum((_t(0.5, (q[0], "Z")), _t(-0.5)))


def _gen_crot(letter: str) -> Callable[[Sequence[int]], PauliSum]:
    # (I - Z_c)/2 * P_t/2 = P_t/4 - Z_c P_t/4
    return lambda q: PauliSum(
        (_t(0.25, (q[1], letter)), _t(-0.25, (q[0], "Z"), (q[1], letter)))
    )


def _gen_cp(q: Sequence[int]) -> PauliSum:
    c, t = q
    return PauliSum(
        (_t(-0.25), _t(0.25, (c, "Z")), _t(0.25, (t, "Z")), _t(-0.25, (c, "Z"), (t, "Z")))
    )


# ------------------------------------------------------------------- table

_s2 = 1 / np.sqrt(2)
_H = np.array([[1, 1], [1, -1]], dtype=np.complex128) * _s2
_S = np.diag([1, 1j]).astype(np.complex128)
_T = np.diag([1, np.exp(1j * np.pi / 4)]).astype(np.complex128)
_SX = 0.5 * np.array([[1 + 1j, 1 - 1j], [1 - 1j, 1 + 1j]], dtype=np.complex128)
_SWAP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=np.complex128)
_ISWAP = np.array([[1, 0, 0, 0], [0, 0, 1j, 0], [0, 1j, 0, 0], [0, 0, 0, 1]], dtype=np.complex128)


def _build() -> dict[str, GateSpec]:
    specs: list[GateSpec] = []

    def fixed(name, arity, m, diagonal=False, clifford=False):
        specs.append(GateSpec(name, arity, 0, _fixed(m), None, diagonal, clifford))

    fixed("I", 1, _I2, True, True)
    fixed("H", 1, _H, False, True)
    fixed("X", 1, _X, False, True)
    fixed("Y", 1, _Y, False, True)
    fixed("Z", 1, _Z, True, True)
    fixed("S", 1, _S, True, True)
    fixed("SDG", 1, _S.conj().T, True, True)
    fixed("T", 1, _T, True, False)
    fixed("TDG", 1, _T.conj().T, True, False)
    fixed("SX", 1, _SX, False, True)
    fixed("SXDG", 1, _SX.conj().T, False, True)
    fixed("CX", 2, _controlled(_X, 1), False, True)
    fixed("CY", 2, _controlled(_Y, 1), False, True)
    fixed("CZ", 2, _controlled(_Z, 1), True, True)
    fixed("CH", 2, _controlled(_H, 1), False, False)
    fixed("SWAP", 2, _SWAP, False, True)
    fixed("ISWAP", 2, _ISWAP, False, True)
    fixed("CCX", 3, _controlled(_X, 2), False, False)
    fixed("CCZ", 3, _controlled(_Z, 2), True, False)
    fixed("CSWAP", 3, _controlled(_SWAP, 1), False, False)

    for letter in "XYZ":
        specs.append(GateSpec(f"R{letter}", 1, 1, _rot1(letter), _gen_rot1(letter),
                              letter == "Z", False, (0, letter)))
    specs.append(GateSpec("P", 1, 1, _p_matrix, _gen_p, True))
    specs.append(GateSpec("U", 1, 3, _u_matrix))
    for letters, name in (("XX", "RXX"), ("YY", "RYY"), ("ZZ", "RZZ"), ("ZX", "RZX")):
        specs.append(GateSpec(name, 2, 1, _rot2(letters), _gen_rot2(letters),
                              letters == "ZZ", False, (0, letters)))
    for letter in "XYZ":
        rot = _rot1(letter)
        specs.append(GateSpec(
            f"CR{letter}", 2, 1, (lambda r: lambda a: _controlled(r(a), 1))(rot),
            _gen_crot(letter), letter == "Z", False, (1, letter)))
    specs.append(GateSpec("CP", 2, 1, lambda a: _controlled(_p_matrix(a), 1), _gen_cp, True))
    return {s.name: s for s in specs}


GATE_SPECS: dict[str, GateSpec] = _build()

#: Gates whose generator spectrum has frequencies {1/2, 1} and so need the
#: 4-term parameter-shift rule (controlled rotations).
SHIFT_4TERM_GATES = frozenset({"CRX", "CRY", "CRZ"})


def gate_matrix(name: str, angles: Sequence[float] = ()) -> np.ndarray:
    """Matrix of gate ``name`` for numeric ``angles`` (little-endian local bits)."""
    return GATE_SPECS[name].matrix(angles)
