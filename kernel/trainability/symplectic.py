"""Bit-packed symplectic Pauli algebra (PRD 14 addendum §A).

A Pauli string on ``n`` qubits is stored as ``i**phase * P_0 ⊗ ... ⊗ P_{n-1}``.
Qubit ``q`` is bit ``q % 64`` of word ``q // 64`` of two ``uint64`` rows ``x`` and
``z``; the single-qubit factor is fixed by ``(x, z)``::

    (0,0) I    (1,0) X    (0,1) Z    (1,1) Y      # Y is the *Hermitian* Y, not XZ

Everything is vectorized over a batch (leading axis); there are no per-string
Python loops on hot paths.

Derivations used throughout
---------------------------
*Commutation.*  ``P`` and ``Q`` anticommute iff the symplectic form
``popcount((x_P & z_Q) ^ (z_P & x_Q))`` is odd.

*Products and phases.*  Write a Hermitian string as ``i**k X^x Z^z`` with
``k = popcount(x & z)`` (because ``Y = i X Z``).  Since
``(X^x1 Z^z1)(X^x2 Z^z2) = (-1)^{z1·x2} X^{x1+x2} Z^{z1+z2}``, the product of two
strings has bits ``(x1^x2, z1^z2)`` and, in the ``X^x Z^z`` frame, phase
``p1' + p2' + 2·popcount(z1 & x2)`` where ``p' = phase + popcount(x & z)``.  The
Hermitian-frame phase of the result subtracts ``popcount(x_r & z_r)`` again.

*Clifford conjugation.*  ``CliffordConjugator`` returns ``U† P U`` for
``U = g_k ... g_1`` (``g_1`` applied first), i.e. the Heisenberg-picture image of
``P``.  Natively this is a sequence of table lookups, innermost gate ``g_k``
first.  The tables (``_symplectic_gates``) are derived from dense gate matrices
and cross-checked against Stim in the tests.  With Stim available the whole
circuit is compiled to one tableau; the images of the ``2n`` generators then
determine the image of any string by products (``X^x Z^z`` is a product of
generator images), still vectorized over the batch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

import numpy as np

from . import _symplectic_gates as _g
from ._symplectic_gates import SUPPORTED_NAMES as _SUPPORTED_NAMES  # noqa: F401
from ._symplectic_gates import clifford_decomposition, is_clifford_gate  # noqa: F401
from ._symplectic_keys import group_rows

try:  # Stim is optional.
    import stim as _stim
except ImportError:  # pragma: no cover
    _stim = None

WORD_BITS = 64
_HAS_BITWISE_COUNT = hasattr(np, "bitwise_count")
_ONE = np.uint64(1)
_PHASE_PREFIX = {"": 0, "+": 0, "i": 1, "+i": 1, "-": 2, "-i": 3}
_LABEL_RE = re.compile(r"^(?P<pre>[+-]?i?)(?P<body>[IXYZ]*)$")
_LETTER_BITS = {"I": (0, 0), "X": (1, 0), "Z": (0, 1), "Y": (1, 1)}
_BITS_LETTER = {(0, 0): "I", (1, 0): "X", (0, 1): "Z", (1, 1): "Y"}


def n_words(n_qubits: int) -> int:
    """Words needed for ``n_qubits`` (at least one)."""
    return max(1, -(-int(n_qubits) // WORD_BITS))


def popcount(words: np.ndarray) -> np.ndarray:
    """Per-row popcount summed over the last axis (``np.bitwise_count`` when available)."""
    words = np.asarray(words, dtype=np.uint64)
    if _HAS_BITWISE_COUNT:
        return np.bitwise_count(words).sum(axis=-1, dtype=np.int64)
    v = words - ((words >> np.uint64(1)) & np.uint64(0x5555555555555555))
    v = (v & np.uint64(0x3333333333333333)) + ((v >> np.uint64(2)) & np.uint64(0x3333333333333333))
    v = (v + (v >> np.uint64(4))) & np.uint64(0x0F0F0F0F0F0F0F0F)
    with np.errstate(over="ignore"):
        v = (v * np.uint64(0x0101010101010101)) >> np.uint64(56)
    return v.sum(axis=-1, dtype=np.int64)


def _parity(words: np.ndarray) -> np.ndarray:
    """Parity of the total popcount over the last axis."""
    folded = np.bitwise_xor.reduce(np.asarray(words, dtype=np.uint64), axis=-1)
    if _HAS_BITWISE_COUNT:
        return (np.bitwise_count(folded) & 1).astype(bool)
    return (popcount(folded[..., None]) & 1).astype(bool)


@dataclass
class PauliArray:
    """A batch of ``N`` Pauli strings on ``n_qubits`` qubits (treated as immutable)."""

    n_qubits: int
    x: np.ndarray       # (N, W) uint64
    z: np.ndarray       # (N, W) uint64
    phase: np.ndarray   # (N,) uint8, power of i

    def __post_init__(self) -> None:
        self.x = np.ascontiguousarray(self.x, dtype=np.uint64)
        self.z = np.ascontiguousarray(self.z, dtype=np.uint64)
        self.phase = np.ascontiguousarray(self.phase, dtype=np.uint8) & np.uint8(3)
        if self.x.ndim != 2 or self.x.shape != self.z.shape or self.x.shape[0] != self.phase.shape[0]:
            raise ValueError("inconsistent PauliArray shapes")
        if self.x.shape[1] != n_words(self.n_qubits):
            raise ValueError("word count does not match n_qubits")

    # -- construction -----------------------------------------------------
    @staticmethod
    def identity(n_qubits: int, count: int = 1) -> "PauliArray":
        w = n_words(n_qubits)
        return PauliArray(n_qubits, np.zeros((count, w), np.uint64), np.zeros((count, w), np.uint64),
                          np.zeros(count, np.uint8))

    @staticmethod
    def from_bits(n_qubits: int, bits: Sequence[tuple[Sequence[int], Sequence[int], int]]) -> "PauliArray":
        """From ``(x_bits, z_bits, phase)`` triples of 0/1 sequences (length ``n_qubits``)."""
        out = PauliArray.identity(n_qubits, len(bits))
        for i, (xb, zb, ph) in enumerate(bits):
            for q in range(n_qubits):
                w, b = divmod(q, WORD_BITS)
                if xb[q]:
                    out.x[i, w] |= _ONE << np.uint64(b)
                if zb[q]:
                    out.z[i, w] |= _ONE << np.uint64(b)
            out.phase[i] = ph & 3
        return out

    @staticmethod
    def from_labels(labels: Sequence[str], n_qubits: int | None = None) -> "PauliArray":
        """Parse ``"XIZY"``, ``"-XZ"``, ``"iY"``, ``"-iY"``; leftmost character is qubit 0."""
        parsed = []
        for lab in labels:
            m = _LABEL_RE.match(lab.strip())
            if not m:
                raise ValueError(f"bad Pauli label {lab!r}")
            parsed.append((_PHASE_PREFIX[m["pre"]], m["body"]))
        n = n_qubits if n_qubits is not None else max((len(b) for _, b in parsed), default=1)
        out = PauliArray.identity(n, len(parsed))
        for i, (ph, body) in enumerate(parsed):
            if len(body) > n:
                raise ValueError(f"label {labels[i]!r} longer than n_qubits={n}")
            out.phase[i] = ph
            for q, ch in enumerate(body):
                xb, zb = _LETTER_BITS[ch]
                w, b = divmod(q, WORD_BITS)
                if xb:
                    out.x[i, w] |= _ONE << np.uint64(b)
                if zb:
                    out.z[i, w] |= _ONE << np.uint64(b)
        return out

    @staticmethod
    def from_sparse(terms: Sequence[tuple[tuple[int, str], ...]], n_qubits: int) -> "PauliArray":
        """From ``PauliTerm.ops``-shaped terms ``((qubit, 'X'), ...)`` (phase 0)."""
        out = PauliArray.identity(n_qubits, len(terms))
        for i, ops in enumerate(terms):
            for q, letter in ops:
                letter = letter.upper()
                if letter == "I":
                    continue
                if letter not in _LETTER_BITS or not 0 <= q < n_qubits:
                    raise ValueError(f"bad Pauli op {(q, letter)!r} for n_qubits={n_qubits}")
                xb, zb = _LETTER_BITS[letter]
                w, b = divmod(int(q), WORD_BITS)
                bit = _ONE << np.uint64(b)
                if (out.x[i, w] | out.z[i, w]) & bit:
                    raise ValueError(f"duplicate qubit {q} in term {ops!r}")
                if xb:
                    out.x[i, w] |= bit
                if zb:
                    out.z[i, w] |= bit
        return out

    # -- conversion ------------------------------------------------------
    def _letters(self, i: int) -> list[tuple[int, str]]:
        ops = []
        for w in range(self.x.shape[1]):
            xw, zw = int(self.x[i, w]), int(self.z[i, w])
            both = xw | zw
            while both:
                b = (both & -both).bit_length() - 1
                both &= both - 1
                ops.append((w * WORD_BITS + b, _BITS_LETTER[((xw >> b) & 1, (zw >> b) & 1)]))
        return ops

    def to_labels(self) -> list[str]:
        prefixes = ["", "i", "-", "-i"]
        labels = []
        for i in range(len(self)):
            chars = ["I"] * self.n_qubits
            for q, letter in self._letters(i):
                chars[q] = letter
            labels.append(prefixes[int(self.phase[i])] + "".join(chars))
        return labels

    def to_sparse(self) -> list[tuple[int, tuple[tuple[int, str], ...]]]:
        return [(int(self.phase[i]), tuple(self._letters(i))) for i in range(len(self))]

    def __len__(self) -> int:
        return int(self.x.shape[0])

    def take(self, idx) -> "PauliArray":
        """Rows selected by an index array, boolean mask or slice (always a copy)."""
        if isinstance(idx, (int, np.integer)):
            idx = [int(idx)]
        return PauliArray(self.n_qubits, self.x[idx], self.z[idx], self.phase[idx])

    @staticmethod
    def concat(parts: Sequence["PauliArray"]) -> "PauliArray":
        n = parts[0].n_qubits
        return PauliArray(n, np.concatenate([p.x for p in parts]), np.concatenate([p.z for p in parts]),
                          np.concatenate([p.phase for p in parts]))

    def with_phase(self, phase) -> "PauliArray":
        return PauliArray(self.n_qubits, self.x, self.z, np.broadcast_to(phase, (len(self),)).copy())


def weight(p: PauliArray) -> np.ndarray:
    """Number of non-identity sites per string, ``(N,)``."""
    return popcount(p.x | p.z)


def anticommutes(p: PauliArray, i: int, q: PauliArray) -> np.ndarray:
    """``(N,)`` bool: does ``p[i]`` anticommute with each ``q[j]``?"""
    return _parity((p.x[i] & q.z) ^ (p.z[i] & q.x))


def anticommute_matrix(a: PauliArray, b: PauliArray) -> np.ndarray:
    """``(Na, Nb)`` bool anticommutation table (intended for small batches)."""
    t = (a.x[:, None, :] & b.z[None, :, :]) ^ (a.z[:, None, :] & b.x[None, :, :])
    return _parity(t)


def multiply(a: PauliArray, b: PauliArray) -> PauliArray:
    """Elementwise ``a[j]·b[j]`` (broadcasting a length-1 operand) with exact phase."""
    if a.n_qubits != b.n_qubits:
        raise ValueError("n_qubits mismatch")
    if len(a) != len(b) and len(a) != 1 and len(b) != 1:
        raise ValueError("length mismatch")
    rx, rz = a.x ^ b.x, a.z ^ b.z
    total = (a.phase.astype(np.int64) + b.phase.astype(np.int64) + popcount(a.x & a.z)
             + popcount(b.x & b.z) + 2 * popcount(a.z & b.x) - popcount(rx & rz))
    return PauliArray(a.n_qubits, rx, rz, (total & 3).astype(np.uint8))


def commutator_string(a: PauliArray, b: PauliArray) -> PauliArray:
    """For anticommuting pairs ``[a,b]/2 = a·b`` (phase tracked). The caller filters pairs."""
    return multiply(a, b)


def is_z_type(p: PauliArray) -> np.ndarray:
    """``(N,)`` bool: no X/Y factors, so ``<0..0|P|0..0>`` is nonzero."""
    return ~p.x.any(axis=1)


def expectation_zero_state(p: PauliArray) -> np.ndarray:
    """``(N,)`` complex: ``i**phase`` for Z-type strings, else 0."""
    powers = np.array([1, 1j, -1, -1j], dtype=np.complex128)
    return np.where(is_z_type(p), powers[p.phase], 0.0 + 0.0j)


# --------------------------------------------------------------------------
# Clifford conjugation
# --------------------------------------------------------------------------
class CliffordConjugator:
    """Heisenberg conjugation ``P -> U† P U`` for ``U = g_k ... g_1`` (vectorized)."""

    SUPPORTED: frozenset[str] = _g.SUPPORTED
    #: auto mode switches to Stim once the circuit has more than this many gates per qubit
    AUTO_STIM_GATES_PER_QUBIT = 2

    def __init__(self, gates: Sequence[tuple[str, tuple[int, ...]]], n_qubits: int, *,
                 use_stim: bool | None = None):
        self.n_qubits = int(n_qubits)
        self.gates: list[tuple[str, tuple[int, ...]]] = []
        for name, qubits in gates:
            canon = _g.canonical_name(name)
            qs = tuple(int(q) for q in qubits)
            if len(qs) != _g.arity(canon) or len(set(qs)) != len(qs) or any(not 0 <= q < self.n_qubits for q in qs):
                raise ValueError(f"bad qubits {qubits!r} for gate {name!r} on {self.n_qubits} qubits")
            self.gates.append((canon, qs))
        if use_stim is None:
            use_stim = _stim is not None and len(self.gates) > self.AUTO_STIM_GATES_PER_QUBIT * self.n_qubits
        if use_stim and _stim is None:
            raise RuntimeError("use_stim=True but stim is not installed")
        self.backend = "stim" if use_stim else "native"
        self._images: tuple[PauliArray, PauliArray] | None = None

    def conjugate(self, p: PauliArray) -> PauliArray:
        if p.n_qubits != self.n_qubits:
            raise ValueError("n_qubits mismatch")
        if self.backend == "stim":
            return self._conjugate_stim(p)
        return self._conjugate_native(p)

    # native ------------------------------------------------------------
    def _conjugate_native(self, p: PauliArray) -> PauliArray:
        x, z = p.x.copy(), p.z.copy()
        phase = p.phase.astype(np.int64)
        for name, qubits in reversed(self.gates):
            table = _g.gate_table(name)
            idx = np.zeros(len(p), dtype=np.intp)
            slots = []
            for t, q in enumerate(qubits):
                w, b = divmod(q, WORD_BITS)
                sh = np.uint64(b)
                slots.append((w, sh))
                idx |= ((x[:, w] >> sh) & _ONE).astype(np.intp) << (2 * t)
                idx |= ((z[:, w] >> sh) & _ONE).astype(np.intp) << (2 * t + 1)
            out = table.out_idx[idx]
            phase += 2 * table.flip[idx].astype(np.int64)
            for t, (w, sh) in enumerate(slots):
                keep = ~(_ONE << sh)
                x[:, w] = (x[:, w] & keep) | (((out >> (2 * t)) & 1).astype(np.uint64) << sh)
                z[:, w] = (z[:, w] & keep) | (((out >> (2 * t + 1)) & 1).astype(np.uint64) << sh)
        return PauliArray(p.n_qubits, x, z, (phase & 3).astype(np.uint8))

    # stim --------------------------------------------------------------
    def generator_images(self) -> tuple[PauliArray, PauliArray]:
        """Images ``U† X_q U`` and ``U† Z_q U`` for all ``q`` (computed via one Stim tableau)."""
        if self._images is None:
            if _stim is None:
                raise RuntimeError("stim is not installed")
            circ = _stim.Circuit()
            circ.append("I", [self.n_qubits - 1])
            for name, qubits in self.gates:
                circ.append(_g.STIM_NAMES[name], list(qubits))
            inv = _stim.Tableau.from_circuit(circ).inverse()
            xs = [inv.x_output(q) for q in range(self.n_qubits)]
            zs = [inv.z_output(q) for q in range(self.n_qubits)]
            self._images = (_from_stim(xs, self.n_qubits), _from_stim(zs, self.n_qubits))
        return self._images

    def _conjugate_stim(self, p: PauliArray) -> PauliArray:
        x_img, z_img = self.generator_images()
        return apply_images(x_img, z_img, p)


def _from_stim(strings: Sequence, n_qubits: int) -> PauliArray:
    w = n_words(n_qubits)
    xs = np.zeros((len(strings), w * WORD_BITS), dtype=np.uint8)
    zs = np.zeros_like(xs)
    phase = np.zeros(len(strings), dtype=np.uint8)
    for i, s in enumerate(strings):
        xb, zb = s.to_numpy()
        xs[i, :n_qubits], zs[i, :n_qubits] = xb, zb
        sign = s.sign
        phase[i] = {1: 0, 1j: 1, -1: 2, -1j: 3}[complex(sign) if isinstance(sign, complex) else sign]
    pack = lambda a: np.packbits(a, axis=1, bitorder="little").view("<u8").astype(np.uint64)  # noqa: E731
    return PauliArray(n_qubits, pack(xs), pack(zs), phase)


def apply_images(x_img: PauliArray, z_img: PauliArray, p: PauliArray) -> PauliArray:
    """Image of ``p`` under the automorphism that sends generators ``X_q, Z_q`` to the given strings.

    Uses ``i^phase · P = i^{phase + #Y} Π_q X_q^{x_q} Π_q Z_q^{z_q}``; one vectorized pass per
    qubit that is touched by any string in the batch.
    """
    n = p.n_qubits
    acc = PauliArray(n, np.zeros_like(p.x), np.zeros_like(p.z), ((p.phase.astype(np.int64) + popcount(p.x & p.z)) & 3))
    touched = np.bitwise_or.reduce(p.x | p.z, axis=0) if len(p) else np.zeros(p.x.shape[1], np.uint64)
    for bits, img in ((p.x, x_img), (p.z, z_img)):
        for q in range(n):
            w, b = divmod(q, WORD_BITS)
            if not (int(touched[w]) >> b) & 1:
                continue
            rows = np.nonzero((bits[:, w] >> np.uint64(b)) & _ONE)[0]
            if rows.size == 0:
                continue
            prod = multiply(acc.take(rows), img.take([q]))
            acc.x[rows], acc.z[rows], acc.phase[rows] = prod.x, prod.z, prod.phase
    return acc


# --------------------------------------------------------------------------
# Frontier
# --------------------------------------------------------------------------
class PauliFrontier:
    """Hash map from ``(x‖z)`` keys to accumulated real weights.

    Strings must be Hermitian (phase 0 or 2); the sign is folded into the weight.
    """

    def __init__(self, n_qubits: int, dtype=np.float64):
        w = n_words(n_qubits)
        self.n_qubits = int(n_qubits)
        self.dtype = dtype
        self._x = np.zeros((0, w), np.uint64)
        self._z = np.zeros((0, w), np.uint64)
        self._w = np.zeros(0, dtype)
        self.discarded = 0.0

    @staticmethod
    def from_array(p: PauliArray, weights: np.ndarray) -> "PauliFrontier":
        out = PauliFrontier(p.n_qubits)
        out.add(p, weights)
        return out

    def add(self, p: PauliArray, weights: np.ndarray) -> None:
        """Merge ``weights * p`` into the map (duplicates accumulate)."""
        weights = np.asarray(weights, dtype=self.dtype)
        if len(weights) != len(p):
            raise ValueError("weights/strings length mismatch")
        if np.any(p.phase & 1):
            raise ValueError("PauliFrontier needs Hermitian strings (phase 0 or 2)")
        signed = np.where(p.phase == 2, -weights, weights)
        x = np.concatenate([self._x, p.x])
        z = np.concatenate([self._z, p.z])
        w = np.concatenate([self._w, signed])
        if len(w) == 0:
            return
        first, inverse = group_rows(np.concatenate([x, z], axis=1))
        self._x, self._z = x[first], z[first]
        self._w = np.bincount(inverse, weights=w, minlength=len(first)).astype(self.dtype)

    def to_array(self) -> tuple[PauliArray, np.ndarray]:
        return (PauliArray(self.n_qubits, self._x.copy(), self._z.copy(), np.zeros(len(self._w), np.uint8)),
                self._w.copy())

    def __len__(self) -> int:
        return int(self._w.shape[0])

    def prune(self, *, max_weight: int | None, min_abs: float) -> float:
        """Drop entries above ``max_weight`` or with ``|w| < min_abs``; return discarded ``Σ|w|``."""
        drop = np.abs(self._w) < min_abs
        if max_weight is not None:
            drop |= popcount(self._x | self._z) > max_weight
        lost = float(np.abs(self._w[drop]).sum())
        keep = ~drop
        self._x, self._z, self._w = self._x[keep], self._z[keep], self._w[keep]
        self.discarded += lost
        return lost
