"""Pauli sums, the observable text grammar and fast Pauli application.

Conventions
-----------
* Qubit ``q`` is bit ``q`` of the basis index (little-endian, Qiskit order).
* A :class:`PauliTerm` is ``coeff * prod_q P_q`` with real ``coeff`` and
  ``P_q`` in {X, Y, Z}; identity factors are omitted.  A term with no ops is
  the identity (scaled by ``coeff``).
* Pauli action on a basis state ``|x>``: with ``xmask`` the qubits carrying
  X or Y and ``zmask`` those carrying Z or Y,
  ``P|x> = i^{nY} (-1)^{popcount(x & zmask)} |x ^ xmask>``.
  (Y = iXZ acts as Z first, then X, then the factor i.)

Observable text grammar (see :func:`parse_observable`)::

    expr   := [sign] term (sign term)*       sign := '+' | '-'
    term   := [number ['*']] factor (['*'] factor)*  |  number
    factor := ('X'|'Y'|'Z'|'I') digits        (case-insensitive)

Columns reported by :class:`ObservableError` are **0-based character
offsets** into the spec string.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

__all__ = [
    "ObservableError",
    "PauliTerm",
    "PauliSum",
    "parse_observable",
    "apply_pauli_term",
    "pauli_sum_matrix",
    "term_masks",
    "multiply_ops",
    "basis_parity",
]

_PAULI_LETTERS = "XYZ"
_NUMBER_RE = re.compile(r"(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
_FACTOR_RE = re.compile(r"([XYZIxyzi])(\d+)")
_MAX_QUBIT_DIGITS = 6


class ObservableError(ValueError):
    """Raised for an invalid observable spec; ``column`` is a 0-based offset."""

    def __init__(self, message: str, column: int = 0) -> None:
        super().__init__(message)
        self.message = message
        self.column = column

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.message} (column {self.column})"


@dataclass(frozen=True)
class PauliTerm:
    """``coeff * prod P_q``; ``ops`` is sorted by qubit, identity omitted."""

    coeff: float
    ops: tuple[tuple[int, str], ...] = ()

    def __post_init__(self) -> None:
        qubits = [q for q, _ in self.ops]
        if qubits != sorted(set(qubits)):
            raise ValueError("PauliTerm.ops must be sorted with unique qubits")
        if any(p not in _PAULI_LETTERS for _, p in self.ops):
            raise ValueError("PauliTerm.ops letters must be X, Y or Z")

    @property
    def weight(self) -> int:
        return len(self.ops)


@dataclass(frozen=True)
class PauliSum:
    """A real-coefficient sum of Pauli terms (a Hermitian operator)."""

    terms: tuple[PauliTerm, ...]

    def max_qubit(self) -> int:
        """Largest qubit index touched, or -1 if every term is identity."""
        return max((q for t in self.terms for q, _ in t.ops), default=-1)

    def weight(self) -> int:
        """Maximum term weight."""
        return max((t.weight for t in self.terms), default=0)

    def scaled(self, factor: float) -> "PauliSum":
        return PauliSum(tuple(PauliTerm(t.coeff * factor, t.ops) for t in self.terms))

    def to_text(self) -> str:
        """Canonical text, e.g. ``0.5*Z0*Z1 + X2``; parses back to the same sum."""
        if not self.terms:
            return "0"
        out: list[str] = []
        for i, t in enumerate(self.terms):
            mag = abs(t.coeff)
            body = "*".join(f"{p}{q}" for q, p in t.ops)
            if body and mag == 1.0:
                piece = body
            elif body:
                piece = f"{_fmt(mag)}*{body}"
            else:
                piece = _fmt(mag)
            if t.coeff < 0:
                out.append(("-" + piece) if i == 0 else ("- " + piece))
            else:
                out.append(piece if i == 0 else "+ " + piece)
        return " ".join(out)


def _fmt(x: float) -> str:
    s = repr(float(x))
    return s[:-2] if s.endswith(".0") else s


# ----------------------------------------------------------------- algebra


_MUL = {
    ("X", "X"): (1, None), ("Y", "Y"): (1, None), ("Z", "Z"): (1, None),
    ("X", "Y"): (1j, "Z"), ("Y", "X"): (-1j, "Z"),
    ("Y", "Z"): (1j, "X"), ("Z", "Y"): (-1j, "X"),
    ("Z", "X"): (1j, "Y"), ("X", "Z"): (-1j, "Y"),
}


def multiply_ops(
    a: list[tuple[int, str]],
    b: list[tuple[int, str]],
) -> tuple[complex, tuple[tuple[int, str], ...]]:
    """Product of two Pauli strings (``a`` then ``b`` applied as ``a*b``)."""
    cur: dict[int, str] = dict(a)
    phase: complex = 1
    for q, p in b:
        if q not in cur:
            cur[q] = p
            continue
        ph, res = _MUL[(cur[q], p)]
        phase *= ph
        if res is None:
            del cur[q]
        else:
            cur[q] = res
    return phase, tuple(sorted(cur.items()))


def _collapse_factors(
    factors: list[tuple[int, str]],
) -> tuple[complex, tuple[tuple[int, str], ...]]:
    """Left-to-right product of factors (duplicate qubits multiplied out)."""
    phase: complex = 1
    ops: tuple[tuple[int, str], ...] = ()
    for f in factors:
        ph, ops = multiply_ops(list(ops), [f])
        phase *= ph
    return phase, ops


def _merge_terms(items: list[tuple[float, tuple[tuple[int, str], ...]]]) -> PauliSum:
    acc: dict[tuple[tuple[int, str], ...], float] = {}
    for coeff, ops in items:
        acc[ops] = acc.get(ops, 0.0) + coeff
    return PauliSum(tuple(PauliTerm(c, o) for o, c in acc.items() if c != 0.0))


# ----------------------------------------------------------------- parsing


def _preset(body: str, n_qubits: int) -> PauliSum:
    m = re.fullmatch(r"\s*([a-z_]+)\s*(?:\(\s*h\s*=\s*([^)]*?)\s*\))?\s*", body.lower())
    if not m:
        raise ObservableError(f"malformed preset '{body}'", len("preset:"))
    name, h_text = m.group(1), m.group(2)
    if h_text is not None and name != "tfim":
        raise ObservableError(f"preset '{name}' takes no arguments", len("preset:"))
    n = n_qubits
    if name == "local_z":
        terms = [PauliTerm(1.0 / n, ((q, "Z"),)) for q in range(n)]
    elif name == "global_z":
        terms = [PauliTerm(1.0, tuple((q, "Z") for q in range(n)))]
    elif name in ("zz_chain", "tfim"):
        if n < 2:
            raise ObservableError(f"preset '{name}' needs at least 2 qubits", 0)
        sign = 1.0 if name == "zz_chain" else -1.0
        terms = [PauliTerm(sign, ((q, "Z"), (q + 1, "Z"))) for q in range(n - 1)]
        if name == "tfim":
            try:
                h = 1.0 if h_text is None else float(h_text)
            except ValueError:
                raise ObservableError(f"invalid h value '{h_text}'", len("preset:")) from None
            if not np.isfinite(h):
                raise ObservableError("h must be finite", len("preset:"))
            if h != 0.0:
                terms += [PauliTerm(-h, ((q, "X"),)) for q in range(n)]
    else:
        raise ObservableError(f"unknown preset '{name}'", len("preset:"))
    return PauliSum(tuple(terms))


def parse_observable(spec: str, n_qubits: int) -> PauliSum:
    """Parse an observable spec into a merged, Hermitian :class:`PauliSum`.

    Raises :class:`ObservableError` (with a 0-based ``column``) on bad syntax,
    out-of-range qubits, non-Hermitian products or an identically-zero sum.
    """
    if not isinstance(spec, str):
        raise ObservableError("observable must be a string", 0)
    if n_qubits < 1:
        raise ObservableError("n_qubits must be >= 1", 0)
    stripped = spec.strip()
    if stripped.lower().startswith("preset:"):
        start = spec.lower().index("preset:") + len("preset:")
        return _preset(spec[start:], n_qubits)
    return _parse_text(spec, n_qubits)


def _skip_ws(s: str, i: int) -> int:
    while i < len(s) and s[i].isspace():
        i += 1
    return i


def _parse_text(s: str, n: int) -> PauliSum:
    i = _skip_ws(s, 0)
    if i >= len(s):
        raise ObservableError("empty observable", 0)
    items: list[tuple[float, tuple[tuple[int, str], ...]]] = []
    sign = 1.0
    while True:
        if i < len(s) and s[i] in "+-":
            sign = -1.0 if s[i] == "-" else 1.0
            i = _skip_ws(s, i + 1)
        term_start = i
        coeff, factors, i = _parse_term(s, i, n)
        phase, ops = _collapse_factors(factors)
        if abs(phase.imag) > 0:
            raise ObservableError(
                "term is not Hermitian (duplicate qubits multiply to an imaginary phase)",
                term_start,
            )
        items.append((sign * coeff * phase.real, ops))
        i = _skip_ws(s, i)
        if i >= len(s):
            break
        if s[i] not in "+-":
            raise ObservableError(f"unexpected character '{s[i]}'", i)
    merged = _merge_terms(items)
    if not merged.terms:
        raise ObservableError("observable is identically zero", 0)
    return merged


def _parse_term(
    s: str, i: int, n: int
) -> tuple[float, list[tuple[int, str]], int]:
    coeff = 1.0
    saw_number = False
    m = _NUMBER_RE.match(s, i)
    if m:
        coeff = float(m.group(0))
        saw_number = True
        i = _skip_ws(s, m.end())
        if i < len(s) and s[i] == "*":
            i = _skip_ws(s, i + 1)
    factors: list[tuple[int, str]] = []
    while True:
        fm = _FACTOR_RE.match(s, i)
        if not fm:
            break
        digits = fm.group(2)
        if len(digits) > _MAX_QUBIT_DIGITS or int(digits) >= n:
            raise ObservableError(
                f"qubit index {digits} out of range for {n} qubits", fm.start(2)
            )
        letter = fm.group(1).upper()
        if letter != "I":
            factors.append((int(digits), letter))
        i = _skip_ws(s, fm.end())
        if i < len(s) and s[i] == "*":
            nxt = _skip_ws(s, i + 1)
            if not _FACTOR_RE.match(s, nxt):
                raise ObservableError("expected a Pauli factor after '*'", nxt)
            i = nxt
    if not factors and not saw_number:
        if i < len(s):
            raise ObservableError(f"unexpected character '{s[i]}'", i)
        raise ObservableError("expected a term", i)
    return coeff, factors, i


# ------------------------------------------------------- statevector action


def term_masks(term: PauliTerm) -> tuple[int, int, int]:
    """Return ``(xmask, zmask_incl_y, n_y)`` for ``term`` (see module doc)."""
    xmask = zmask = ny = 0
    for q, p in term.ops:
        bit = 1 << q
        if p in "XY":
            xmask |= bit
        if p in "ZY":
            zmask |= bit
        if p == "Y":
            ny += 1
    return xmask, zmask, ny


@lru_cache(maxsize=64)
def _arange(n: int) -> np.ndarray:
    a = np.arange(1 << n, dtype=np.int64)
    a.setflags(write=False)
    return a


@lru_cache(maxsize=32)
def _parity(n: int, mask: int) -> np.ndarray:
    """``(-1)^popcount(x & mask)`` as float64 over x in [0, 2^n)."""
    v = _arange(n) & mask
    for shift in (16, 8, 4, 2, 1):
        v = v ^ (v >> shift)
    out = (1.0 - 2.0 * (v & 1)).astype(np.float64)
    out.setflags(write=False)
    return out


def basis_parity(n: int, mask: int) -> np.ndarray:
    """Read-only float64 vector ``(-1)^popcount(x & mask)`` over all basis x."""
    return _parity(n, mask)


def apply_pauli_term(state: np.ndarray, term: PauliTerm, n: int) -> np.ndarray:
    """Return ``coeff * P @ state`` along the last axis (length ``2**n``)."""
    state = np.asarray(state)
    if state.shape[-1] != 1 << n:
        raise ValueError(f"state last axis must be 2**{n}, got {state.shape[-1]}")
    xmask, zmask, ny = term_masks(term)
    if term.ops and max(q for q, _ in term.ops) >= n:
        raise ValueError("term touches a qubit outside the register")
    scale = term.coeff * (1j ** ny)
    if xmask == 0:
        return state * (scale * _parity(n, zmask))
    src = _arange(n) ^ xmask
    phase = scale * _parity(n, zmask)[src]
    return state[..., src] * phase


def pauli_sum_matrix(ps: PauliSum, n: int) -> np.ndarray:
    """Dense ``2^n x 2^n`` matrix of ``ps`` (little-endian); for tests, n <= 10."""
    if n > 10:
        raise ValueError("pauli_sum_matrix is for tests (n <= 10)")
    dim = 1 << n
    eye = np.eye(dim, dtype=np.complex128)
    total = np.zeros((dim, dim), dtype=np.complex128)
    for t in ps.terms:
        total += apply_pauli_term(eye, t, n).T
    return total
