"""Lowered kernel ops: forward, inverse and adjoint-gradient rules.

Every op acts on a batched state ``(B, 2**n)`` (see ``backends.py``) and has

* ``forward(bk, s, v)  -> (s', aux)``  where ``v`` is the ``(B, m)`` parameter
  matrix and ``aux`` is whatever the backward pass reuses;
* ``backward(bk, phi, lam, v, aux) -> (phi_prev, lam_prev, dgrad)`` where
  ``phi`` / ``lam`` are the state and the pulled-back ``O|psi>`` *after* the
  op, and ``dgrad`` is ``(B, len(param_idx))`` (or ``None``).

Adjoint rule (U = exp(-i theta G), C = <psi|O|psi>):
``dC/dtheta = 2 Im <lam| G |phi>`` with ``phi = psi_k`` and
``lam = (U_m ... U_{k+1})^dagger O psi_m``.  The chain rule through
``ParamRef.coeff`` is applied here via ``LinAngle``; shared parameters add up
because the program scatters ``dgrad`` columns into the ``(B, m)`` gradient.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from kernel.trainability.backends import Backend, apply_dense, apply_mono
from kernel.trainability.pauli import PauliSum, basis_parity, term_masks

__all__ = [
    "LinAngle",
    "Op",
    "DenseOp",
    "RotOp",
    "DiagOp",
    "MonoOp",
    "ObservablePlan",
]

_EMPTY_IDX = np.zeros(0, dtype=np.int64)


@dataclass(eq=False)
class LinAngle:
    """Angle ``offset + sum_k coeff[k] * v[idx[k]]`` (idx unique)."""

    idx: np.ndarray
    coeff: np.ndarray
    offset: float = 0.0

    @staticmethod
    def constant(value: float) -> "LinAngle":
        return LinAngle(_EMPTY_IDX, np.zeros(0), float(value))

    @property
    def is_constant(self) -> bool:
        return self.idx.size == 0

    def plus(self, other: "LinAngle") -> "LinAngle":
        acc: dict[int, float] = {}
        for i, c in zip(self.idx.tolist() + other.idx.tolist(),
                        self.coeff.tolist() + other.coeff.tolist()):
            acc[i] = acc.get(i, 0.0) + c
        keys = sorted(k for k, c in acc.items() if c != 0.0)
        return LinAngle(
            np.array(keys, dtype=np.int64),
            np.array([acc[k] for k in keys], dtype=float),
            self.offset + other.offset,
        )

    def scaled(self, f: float) -> "LinAngle":
        return LinAngle(self.idx, self.coeff * f, self.offset * f)

    def evaluate(self, bk: Backend, v: Any) -> Any:
        """Per-sample angle ``(B,)``."""
        xp = bk.xp
        if self.is_constant:
            return xp.full((v.shape[0],), self.offset, dtype=xp.float64)
        return v[:, self.idx] @ bk.asarray(self.coeff) + self.offset


class Op:
    """Base class; subclasses set ``kind`` and ``param_idx``."""

    kind = "op"
    param_idx: np.ndarray = _EMPTY_IDX

    def __init__(self) -> None:
        self._dev: dict[tuple[str, str], Any] = {}

    def dev(self, bk: Backend, name: str, array: np.ndarray | None) -> Any:
        """Cache a constant on the backend's device."""
        if array is None:
            return None
        key = (bk.name, name)
        if key not in self._dev:
            self._dev[key] = bk.asarray(array)
        return self._dev[key]

    def forward(self, bk: Backend, s: Any, v: Any) -> tuple[Any, Any]:  # pragma: no cover
        raise NotImplementedError

    def backward(self, bk: Backend, phi: Any, lam: Any, v: Any, aux: Any):  # pragma: no cover
        raise NotImplementedError


class DenseOp(Op):
    """Fixed dense gate on ``qubits`` (``matrix`` is ``2^k x 2^k``)."""

    kind = "dense"

    def __init__(self, qubits: tuple[int, ...], n: int, matrix: np.ndarray) -> None:
        super().__init__()
        self.qubits, self.n = qubits, n
        self.matrix = np.asarray(matrix, dtype=np.complex128)
        self.matrix_dag = np.ascontiguousarray(self.matrix.conj().T)

    def forward(self, bk, s, v):
        return apply_dense(bk, s, self.qubits, self.n, self.dev(bk, "m", self.matrix)), None

    def backward(self, bk, phi, lam, v, aux):
        m = self.dev(bk, "md", self.matrix_dag)
        return (apply_dense(bk, phi, self.qubits, self.n, m),
                apply_dense(bk, lam, self.qubits, self.n, m), None)


class RotOp(Op):
    """``U = I + (cos(t/2)-1) A - i sin(t/2) B`` with ``G = B/2``.

    ``A`` is the control projector, ``B = A * P`` (P a Pauli string on the
    targets).  Covers RX, RY, RXX, RYY, RZX, CRX, CRY.
    """

    kind = "rot"

    def __init__(self, qubits, n, a_mat, b_mat, angle: LinAngle) -> None:
        super().__init__()
        self.qubits, self.n, self.angle = qubits, n, angle
        self.a_mat = np.asarray(a_mat, dtype=np.complex128)
        self.b_mat = np.asarray(b_mat, dtype=np.complex128)
        self.param_idx = angle.idx

    def matrices(self, bk: Backend, theta: Any) -> Any:
        xp = bk.xp
        d = self.a_mat.shape[0]
        half = theta / 2
        c = (xp.cos(half) - 1.0).astype(xp.complex128)[:, None, None]
        s = (-1j * xp.sin(half))[:, None, None]
        eye = xp.eye(d, dtype=xp.complex128)[None]
        return eye + c * self.dev(bk, "a", self.a_mat)[None] + s * self.dev(bk, "b", self.b_mat)[None]

    def forward(self, bk, s, v):
        m = self.matrices(bk, self.angle.evaluate(bk, v))
        return apply_dense(bk, s, self.qubits, self.n, m), m

    def backward(self, bk, phi, lam, v, m):
        xp = bk.xp
        b_phi = apply_dense(bk, phi, self.qubits, self.n, self.dev(bk, "b", self.b_mat))
        # dC/dtheta = 2 Im<lam|G|phi> with G = B/2
        dtheta = xp.einsum("bn,bn->b", xp.conj(lam), b_phi).imag
        m_dag = xp.conj(xp.swapaxes(m, 1, 2))
        dgrad = dtheta[:, None] * bk.asarray(self.angle.coeff)[None, :]
        return (apply_dense(bk, phi, self.qubits, self.n, m_dag),
                apply_dense(bk, lam, self.qubits, self.n, m_dag), dgrad)


class DiagOp(Op):
    """Fused diagonal run: ``psi <- psi * exp(i (phi0 + sum_j v_j hp_j))``.

    ``hp[j]`` is the phase coefficient of ``v[idx[j]]`` over the basis
    (``-sum coeff * g`` for generator eigenvalue vectors ``g``).
    """

    kind = "diag"

    def __init__(self, idx: np.ndarray, hp: np.ndarray, phi0: np.ndarray) -> None:
        super().__init__()
        self.param_idx = idx
        self.hp = np.ascontiguousarray(hp, dtype=np.float64)  # (K, N)
        self.hp_t = np.ascontiguousarray(self.hp.T)  # (N, K)
        self.phi0 = np.asarray(phi0, dtype=np.float64)

    def phase(self, bk: Backend, v: Any) -> Any:
        xp = bk.xp
        ang = v[:, self.param_idx] @ self.dev(bk, "hp", self.hp) + self.dev(bk, "phi0", self.phi0)[None, :]
        return xp.exp(1j * ang)

    def forward(self, bk, s, v):
        ph = self.phase(bk, v)
        return s * ph, ph

    def backward(self, bk, phi, lam, v, ph):
        xp = bk.xp
        # Im(conj(lam) * phi), then dC/dv_j = -2 * sum_x hp_j(x) Im(...)
        im = lam.real * phi.imag - lam.imag * phi.real
        dgrad = -2.0 * (im @ self.dev(bk, "hp_t", self.hp_t))
        conj_ph = xp.conj(ph)
        return phi * conj_ph, lam * conj_ph, dgrad


class MonoOp(Op):
    """Fixed monomial run: ``out[y] = ph[y] * in[src[y]]`` (``None`` = identity/ones)."""

    kind = "mono"

    def __init__(self, src: np.ndarray | None, ph: np.ndarray | None) -> None:
        super().__init__()
        self.src, self.ph = src, ph
        if src is None:
            self.inv = None
            inv_ph = None if ph is None else np.conj(ph)
        else:
            self.inv = np.argsort(src).astype(src.dtype)
            inv_ph = None if ph is None else np.conj(ph)[self.inv]
        self.inv_ph = inv_ph

    def forward(self, bk, s, v):
        return apply_mono(bk, s, self.dev(bk, "src", self.src), self.dev(bk, "ph", self.ph)), None

    def backward(self, bk, phi, lam, v, aux):
        inv, iph = self.dev(bk, "inv", self.inv), self.dev(bk, "iph", self.inv_ph)
        return apply_mono(bk, phi, inv, iph), apply_mono(bk, lam, inv, iph), None


# --------------------------------------------------------------- observables


class ObservablePlan:
    """``O = sum_g f_g(y) * psi[y ^ xmask_g]`` grouped by X-mask.

    ``P|x> = i^{nY} (-1)^{popcount(x & zy)} |x ^ xmask>`` so
    ``(P psi)(y) = i^{nY} (-1)^{popcount((y^xmask) & zy)} psi(y ^ xmask)``.
    """

    def __init__(self, observable: PauliSum, n: int) -> None:
        self.n = n
        size = 1 << n
        idx = np.arange(size, dtype=np.int64)
        groups: dict[int, np.ndarray] = {}
        for term in observable.terms:
            xmask, zmask, ny = term_masks(term)
            sign = basis_parity(n, zmask)[idx ^ xmask] if xmask else basis_parity(n, zmask)
            f = term.coeff * (1j ** ny) * sign
            groups[xmask] = groups.get(xmask, 0) + f
        self.diag = np.real(groups.pop(0)) if 0 in groups else None
        self.groups = [(m, np.asarray(f, dtype=np.complex128), (idx ^ m)) for m, f in groups.items()]
        self._dev: dict[tuple[str, str], Any] = {}

    def _get(self, bk: Backend, key: str, arr: np.ndarray) -> Any:
        k = (bk.name, key)
        if k not in self._dev:
            self._dev[k] = bk.asarray(arr)
        return self._dev[k]

    def apply(self, bk: Backend, s: Any) -> Any:
        out = None
        if self.diag is not None:
            out = s * self._get(bk, "diag", self.diag)[None, :]
        for i, (_, f, src) in enumerate(self.groups):
            term = bk.xp.take(s, self._get(bk, f"s{i}", src), axis=1) * self._get(bk, f"f{i}", f)[None, :]
            out = term if out is None else out + term
        return out if out is not None else s * 0.0

    def expectation(self, bk: Backend, s: Any) -> Any:
        xp = bk.xp
        if not self.groups and self.diag is not None:
            return (s.real ** 2 + s.imag ** 2) @ self._get(bk, "diag", self.diag)
        o_s = self.apply(bk, s)
        return xp.sum(s.real * o_s.real + s.imag * o_s.imag, axis=1)
