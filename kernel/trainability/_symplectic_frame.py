"""Clifford "frame": the Heisenberg map ``P -> V† P V`` for a growing Clifford ``V``.

The frame stores the images of the ``2n`` generators ``X_q, Z_q`` as Python-int
bit strings in the ``i^p X^x Z^z`` form (Python big ints are the fastest way to
handle *single* strings of up to a few hundred qubits).  Appending a gate ``g``
(``V -> g V``) updates only the generators on its support::

    M'(G) = M(g† G g),

because ``(gV)† P (gV) = V† (g† P g) V``.  The PPE uses this to push every Clifford
gate of a rotation program to the end of the circuit: the rotation preceded by
Cliffords ``V`` is replaced by a rotation about ``V† P V`` and the observable is
conjugated once by the full product.
"""

from __future__ import annotations

from typing import Sequence

from ._symplectic_gates import arity, canonical_name, local_generator_images

# (x, z, p) means  i**p * X^x Z^z  with x, z python ints.
_Img = tuple[int, int, int]


def mul(a: _Img, b: _Img) -> _Img:
    """Product ``a·b`` in the ``X^x Z^z`` frame: ``(-1)^{z_a·x_b}`` from reordering."""
    return (a[0] ^ b[0], a[1] ^ b[1], (a[2] + b[2] + 2 * (a[1] & b[0]).bit_count()) & 3)


def _bits(v: int):
    while v:
        low = v & -v
        yield low.bit_length() - 1
        v ^= low


class CliffordFrame:
    """Accumulates ``V = g_m ... g_1`` and evaluates ``V† P V`` for Hermitian strings."""

    def __init__(self, n_qubits: int):
        self.n_qubits = int(n_qubits)
        self._xi: list[_Img] = [(1 << q, 0, 0) for q in range(self.n_qubits)]
        self._zi: list[_Img] = [(0, 1 << q, 0) for q in range(self.n_qubits)]

    def append(self, name: str, qubits: Sequence[int]) -> None:
        """Compose with a Clifford applied *after* everything already in the frame."""
        canon = canonical_name(name)
        qs = tuple(int(q) for q in qubits)
        if len(qs) != arity(canon) or len(set(qs)) != len(qs) or any(not 0 <= q < self.n_qubits for q in qs):
            raise ValueError(f"bad qubits {qubits!r} for gate {name!r}")
        new = []
        for bits, sign in local_generator_images(canon):
            acc: _Img = (0, 0, 2 if sign < 0 else 0)
            for t, q in enumerate(qs):
                xb, zb = bits[2 * t], bits[2 * t + 1]
                if xb and zb:
                    acc = mul(acc, (0, 0, 1))  # Y = i X Z
                if xb:
                    acc = mul(acc, self._xi[q])
                if zb:
                    acc = mul(acc, self._zi[q])
            new.append(acc)
        for t, q in enumerate(qs):
            self._xi[q], self._zi[q] = new[2 * t], new[2 * t + 1]

    def map_string(self, x: int, z: int, sign: int = 1) -> tuple[int, int, int]:
        """Image of the Hermitian string ``sign · P(x, z)``; returns ``(x', z', sign')``."""
        acc: _Img = (0, 0, (2 if sign < 0 else 0) + (x & z).bit_count())
        for q in _bits(x):
            acc = mul(acc, self._xi[q])
        for q in _bits(z):
            acc = mul(acc, self._zi[q])
        herm = (acc[2] - (acc[0] & acc[1]).bit_count()) & 3
        if herm not in (0, 2):  # pragma: no cover - Clifford maps Hermitian to Hermitian
            raise AssertionError("non-Hermitian image")
        return acc[0], acc[1], 1 if herm == 0 else -1
