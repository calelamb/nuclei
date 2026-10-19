"""Dynamical Lie algebra (DLA) closure, classification and g-purity variance prediction.

Setting
-------
Trainable circuits ``Π_k exp(-i θ_k G_k)`` generate (via the Lie group) the dynamical Lie
algebra ``𝔤 = <i G_1, ..., i G_m>_Lie``.  Because ``i`` is a global factor we work with
the Hermitian generators ``G_k`` and the bracket ``[A, B]_H = -i [A, B] / 2`` which maps
Hermitian operators to Hermitian operators (``dim_R`` is unchanged).

Pauli-string generators
-----------------------
For Pauli strings ``P, Q``: ``[P, Q] = 0`` if they commute and ``[P, Q] = 2 P Q`` (again a
string up to a phase) if they anticommute.  The generated algebra is therefore spanned by
a *set of distinct strings*, and ``dim 𝔤 = |set|``.  By the Jacobi identity the algebra is
spanned by right-normed brackets ``[g_{i1}, [g_{i2}, ... g_{ik}]]``, so a breadth-first search
that brackets every newly found string with the *generators* reaches exactly the same set as
testing each new element against the whole basis (a string in the full closure is in the
span of the generator-reachable strings, and strings are linearly independent) but at
``O(dim · #generators)`` instead of ``O(dim²)``.  Each BFS level is a single vectorized
anticommutation matrix (new strings × generators); duplicates are removed by exact row
hashing (``_symplectic_keys.group_rows``).

Pauli-sum generators
--------------------
``pauli_sum_closure`` represents operators as sparse real coefficient vectors over Pauli
strings, brackets via the symplectic product, and keeps an orthonormal basis by Gram-Schmidt
with re-orthogonalization (stability equivalent to modified Gram-Schmidt).  A bracket is kept
when its residual exceeds ``tol · ‖g‖``.

Classification and variance prediction
--------------------------------------
Dimension matches (not isomorphism proofs): ``su(2^n)`` = ``4^n - 1``, ``so(2^n)`` =
``2^{n-1}(2^n - 1)``, ``sp(2^{n-1})`` = ``2^{n-1}(2^n + 1)``, free-fermion ``so(2n)`` =
``n(2n - 1)``.  With the orthonormal basis ``B_j = P_j / sqrt(2^n)`` the g-purity is
``P_𝔤(O) = Σ_j |Tr(B_j O)|² = 2^n Σ_{P ∈ 𝔤} |c_P|²`` for ``O = Σ c_P P`` and
``P_𝔤(|0><0|) = #{P ∈ 𝔤 : P ∈ {I,Z}^n} / 2^n``.  For a simple 𝔤 the variance of the cost of a
deep circuit is ``Var = P_𝔤(ρ) P_𝔤(O) / dim 𝔤`` (Ragone et al., Nat. Commun. 15, 7172 (2024)).
Algebras with polynomial dimension also make expectation values classically computable
(𝔤-sim, Goh et al. 2023).

Reductive 𝔤 (revised after the physics review)
----------------------------------------------
The simple-𝔤 formula is *wrong* for a general DLA: a centre (elements commuting with all of 𝔤)
adds nothing to the variance, and with several simple ideals ``𝔤 = ⊕_j 𝔤_j ⊕ 𝔷`` the group is a
product of independent Haar factors, so the variances add::

    Var = Σ_j P_{𝔤_j}(ρ) P_{𝔤_j}(O) / dim 𝔤_j        (ρ = |0><0|, 𝔷 excluded).

(Applying the simple formula to su(2) ⊕ su(16) gave 0.062 against a measured 0.336.)  For a
Pauli-string basis the centre is the set of strings commuting with the whole basis and the simple
ideals are the connected components of the anticommutation graph on the remaining strings
(:func:`ideal_decomposition`).  For a Pauli-sum basis the ideal structure is not computed: the
prediction is available only when 𝔤 is verifiably simple, i.e. ``dim 𝔤 = 4^n − 1`` (a subalgebra of
su(2^n) of full dimension *is* su(2^n)).
"""

from __future__ import annotations

import time
from typing import Callable, Sequence

import numpy as np

from ._symplectic_keys import group_rows
from .symplectic import PauliArray, is_z_type

_CHUNK_PAIRS = 3_000_000


def _strip_phase(p: PauliArray) -> PauliArray:
    return PauliArray(p.n_qubits, p.x, p.z, np.zeros(len(p), np.uint8))


def _keys(x: np.ndarray, z: np.ndarray) -> np.ndarray:
    return np.concatenate([x, z], axis=1)


def _anticommute_pairs(ax, az, bx, bz) -> tuple[np.ndarray, np.ndarray]:
    t = (ax[:, None, :] & bz[None, :, :]) ^ (az[:, None, :] & bx[None, :, :])
    folded = np.bitwise_xor.reduce(t, axis=2)
    parity = np.bitwise_count(folded) & 1 if hasattr(np, "bitwise_count") else _slow_parity(folded)
    return np.nonzero(parity)


def _slow_parity(folded: np.ndarray) -> np.ndarray:
    out = np.zeros(folded.shape, dtype=np.uint8)
    v = folded.copy()
    while v.any():
        out ^= (v & np.uint64(1)).astype(np.uint8)
        v >>= np.uint64(1)
    return out


def pauli_string_closure(generators: PauliArray, *, max_dimension: int = 4096, time_budget_s: float = 10.0,
                         cancel: Callable[[], bool] | None = None) -> dict:
    """Closure of single-Pauli-string generators under commutators.

    Returns ``{"status": "complete"|"truncated", "dimension", "dimension_lower_bound", "basis": PauliArray,
    "elapsed_ms", "reason"}``; ``reason`` names the limit that truncated the search
    (``max_dimension`` | ``time_budget`` | ``cancelled``) and is ``None`` when complete.
    """
    t0 = time.perf_counter()
    deadline = t0 + float(time_budget_s)
    gens = _strip_phase(generators)
    keep = (gens.x | gens.z).any(axis=1)  # the identity generates nothing
    gens = gens.take(np.nonzero(keep)[0])
    first, _ = group_rows(_keys(gens.x, gens.z)) if len(gens) else (np.zeros(0, np.intp), None)
    gens = gens.take(np.sort(first))
    bx, bz = gens.x.copy(), gens.z.copy()
    if len(bx) > max_dimension:
        bx, bz = bx[:max_dimension], bz[:max_dimension]
    lo, hi, reason = 0, len(bx), None
    if len(gens) > max_dimension:
        reason = "max_dimension"
    while reason is None and lo < hi:
        new_x, new_z = [], []
        known_x, known_z = bx, bz
        for start in range(lo, hi, max(1, _CHUNK_PAIRS // max(len(gens), 1))):
            if cancel is not None and cancel():
                reason = "cancelled"
            elif time.perf_counter() > deadline:
                reason = "time_budget"
            if reason:
                break
            stop = min(hi, start + max(1, _CHUNK_PAIRS // max(len(gens), 1)))
            ii, jj = _anticommute_pairs(bx[start:stop], bz[start:stop], gens.x, gens.z)
            if ii.size == 0:
                continue
            cx, cz = bx[start:stop][ii] ^ gens.x[jj], bz[start:stop][ii] ^ gens.z[jj]
            known = np.concatenate([_keys(known_x, known_z)] + [_keys(a, b) for a, b in zip(new_x, new_z)])
            cand = _keys(cx, cz)
            first, _ = group_rows(np.concatenate([known, cand]))
            fresh = np.sort(first[first >= len(known)]) - len(known)
            if fresh.size:
                new_x.append(cx[fresh])
                new_z.append(cz[fresh])
        if new_x:
            add_x, add_z = np.concatenate(new_x), np.concatenate(new_z)
            room = max_dimension - len(bx)
            if len(add_x) > room:
                add_x, add_z = add_x[:room], add_z[:room]
                reason = reason or "max_dimension"
            lo, hi = len(bx), len(bx) + len(add_x)
            bx, bz = np.concatenate([bx, add_x]), np.concatenate([bz, add_z])
        else:
            lo = hi
    dim = len(bx)
    basis = PauliArray(generators.n_qubits, bx, bz, np.zeros(dim, np.uint8))
    return {"status": "complete" if reason is None else "truncated", "dimension": dim, "dimension_lower_bound": dim,
            "basis": basis, "elapsed_ms": (time.perf_counter() - t0) * 1e3, "reason": reason}


# ---------------------------------------------------------------------------
# Pauli-sum path
# ---------------------------------------------------------------------------
_LETTER_BITS = {"X": (1, 0), "Z": (0, 1), "Y": (1, 1)}
_BITS_LETTER = {(1, 0): "X", (0, 1): "Z", (1, 1): "Y"}
SparseOp = dict  # {((qubit, 'X'|'Y'|'Z'), ...): real coefficient}


def _to_ints(ops) -> tuple[int, int]:
    x = z = 0
    for q, letter in ops:
        letter = letter.upper()
        if letter == "I":
            continue
        xb, zb = _LETTER_BITS[letter]
        x |= xb << int(q)
        z |= zb << int(q)
    return x, z


def _to_ops(x: int, z: int) -> tuple[tuple[int, str], ...]:
    both, ops = x | z, []
    while both:
        low = both & -both
        q = low.bit_length() - 1
        both ^= low
        ops.append((q, _BITS_LETTER[((x >> q) & 1, (z >> q) & 1)]))
    return tuple(ops)


def _herm_bracket(a: dict, b: dict) -> dict:
    """``-i [A, B] / 2`` for Hermitian sums keyed by ``(x, z)`` ints; real coefficients."""
    out: dict[tuple[int, int], float] = {}
    for (xa, za), ca in a.items():
        ka = (xa & za).bit_count()
        for (xb, zb), cb in b.items():
            if ((xa & zb) ^ (za & xb)).bit_count() & 1 == 0:
                continue
            xr, zr = xa ^ xb, za ^ zb
            # P_a P_b = i^{ka + kb + 2 c - kr} R ; bracket coefficient -i * that (always real here)
            expo = (3 + ka + (xb & zb).bit_count() + 2 * (za & xb).bit_count() - (xr & zr).bit_count()) & 3
            sign = 1.0 if expo == 0 else -1.0
            out[(xr, zr)] = out.get((xr, zr), 0.0) + sign * ca * cb
    return out


def _normalize_sum(op: dict, tol: float) -> dict:
    res = {}
    for ops, coeff in op.items():
        c = complex(coeff)
        if abs(c.imag) > tol * max(1.0, abs(c)):
            raise ValueError("Pauli-sum generators must be Hermitian (real coefficients)")
        key = _to_ints(ops) if isinstance(ops, tuple) and (not ops or isinstance(ops[0], tuple)) else ops
        res[key] = res.get(key, 0.0) + c.real
    return res


def pauli_sum_closure(generators: Sequence[SparseOp], *, n_qubits: int, max_dimension: int = 4096,
                      time_budget_s: float = 10.0, tol: float = 1e-9,
                      cancel: Callable[[], bool] | None = None) -> dict:
    """Closure of Hermitian Pauli-sum generators ``{((q, 'Z'), (q+1, 'Z')): 1.0, ...}``.

    Returns ``{"status", "dimension", "dimension_lower_bound", "basis", "elapsed_ms", "reason"}`` where
    ``basis`` is a list of orthonormal real sparse vectors ``{ops: coeff}`` (Pauli coordinates).
    """
    t0 = time.perf_counter()
    deadline = t0 + float(time_budget_s)
    gens = [_normalize_sum(g, tol) for g in generators]
    index: dict[tuple[int, int], int] = {}
    cap_cols, cap_rows = 64, 64
    q = np.zeros((cap_rows, cap_cols))
    basis: list[dict] = []
    reason: str | None = None

    def col(key):
        nonlocal q, cap_cols
        c = index.get(key)
        if c is None:
            c = index[key] = len(index)
            if c >= cap_cols:
                q = np.pad(q, ((0, 0), (0, cap_cols)))
                cap_cols *= 2
        return c

    def try_add(vec: dict, scale: float) -> dict | None:
        nonlocal q, cap_rows
        for key in vec:
            col(key)
        v = np.zeros(cap_cols)
        for key, c in vec.items():
            v[index[key]] = c
        r = len(basis)
        for _ in range(2):
            if r:
                v = v - q[:r].T @ (q[:r] @ v)
        norm = float(np.linalg.norm(v))
        if norm <= tol * max(scale, 1e-300):
            return None
        v = v / norm
        if r >= cap_rows:
            q = np.pad(q, ((0, cap_rows), (0, 0)))
            cap_rows *= 2
        q[r] = v
        inv = {c: k for k, c in index.items()}
        sparse = {inv[int(c)]: float(v[c]) for c in np.nonzero(np.abs(v) > 1e-14)[0]}
        basis.append(sparse)
        return sparse

    queue: list[dict] = []
    for g in gens:
        scale = float(np.sqrt(sum(c * c for c in g.values()))) or 1.0
        if len(basis) >= max_dimension:
            reason = "max_dimension"
            break
        added = try_add(g, scale)
        if added is not None:
            queue.append(added)
    head = 0
    while reason is None and head < len(queue):
        e = queue[head]
        head += 1
        for g in gens:
            if cancel is not None and cancel():
                reason = "cancelled"
            elif time.perf_counter() > deadline:
                reason = "time_budget"
            elif len(basis) >= max_dimension:
                reason = "max_dimension"
            if reason:
                break
            br = _herm_bracket(g, e)
            if not br:
                continue
            scale = float(np.sqrt(sum(c * c for c in g.values())))
            added = try_add(br, 2.0 * scale)
            if added is not None:
                queue.append(added)
    dim = len(basis)
    return {"status": "complete" if reason is None else "truncated", "dimension": dim, "dimension_lower_bound": dim,
            "basis": [{_to_ops(*k): c for k, c in v.items()} for v in basis], "n_qubits": n_qubits,
            "elapsed_ms": (time.perf_counter() - t0) * 1e3, "reason": reason}


def dense_closure(matrices: list[np.ndarray], *, tol: float = 1e-9, hermitian: bool = True) -> int:
    """Brute-force dimension of the real Lie algebra generated by ``matrices`` (reference, small ``n``).

    With ``hermitian=True`` (default) the inputs are Hamiltonian terms ``G`` and the algebra of
    ``i G`` is computed; pass ``hermitian=False`` for anti-Hermitian generators.
    """
    gens = [(1j if hermitian else 1.0) * np.asarray(m, dtype=complex) for m in matrices]
    gens = [g / np.linalg.norm(g) for g in gens if np.linalg.norm(g) > 0]
    size = 2 * gens[0].size if gens else 0
    basis = np.zeros((0, size))
    queue: list[np.ndarray] = []

    def vec(m):
        return np.concatenate([m.real.ravel(), m.imag.ravel()])

    def add(m: np.ndarray, scale: float) -> bool:
        nonlocal basis
        v = vec(m)
        for _ in range(2):
            if len(basis):
                v = v - basis.T @ (basis @ v)
        norm = np.linalg.norm(v)
        if norm <= tol * scale:
            return False
        basis = np.vstack([basis, v / norm])
        queue.append(m / np.linalg.norm(m))
        return True

    for g in gens:
        add(g, 1.0)
    head = 0
    while head < len(queue):
        e = queue[head]
        head += 1
        for g in gens:
            add(g @ e - e @ g, 2.0)
    return int(len(basis))


# ---------------------------------------------------------------------------
# classification, purities, prediction
# ---------------------------------------------------------------------------
def classify_dimension(dim: int, n: int) -> dict:
    """Name the algebra whose dimension equals ``dim`` (a dimension match, not an isomorphism proof)."""
    candidates = []
    if dim == 4 ** n - 1:
        candidates.append(("su", f"su({2 ** n})"))
    if n >= 2 and dim == (2 ** (n - 1)) * (2 ** n - 1):
        candidates.append(("so", f"so({2 ** n})"))
    if dim == (2 ** (n - 1)) * (2 ** n + 1):
        candidates.append(("sp", f"sp({2 ** (n - 1)})"))
    if n >= 2 and dim == n * (2 * n - 1):
        candidates.append(("free_fermion", f"so({2 * n})"))
    note = ("Classification is by exact dimension match, not an isomorphism proof; "
            "other algebras can share a dimension.")
    if not candidates:
        return {"label": "other", "family": "other", "confidence": "none", "candidates": [], "dimension": dim,
                "note": note}
    family, label = candidates[0]
    return {"label": label, "family": family, "confidence": "exact_dimension_match", "dimension": dim,
            "candidates": [{"family": f, "label": lab} for f, lab in candidates], "note": note}


def ideal_decomposition(basis: PauliArray) -> dict:
    """Centre and simple ideals of a Pauli-string algebra.

    Returns ``{"labels": int array (-1 = central), "ideal_sizes": [dim of each ideal],
    "centre_dimension": int}``.  Central strings anticommute with no basis string; the ideals are the
    connected components of the anticommutation graph on the non-central strings (strings in different
    components commute, so ``𝔤 = 𝔷 ⊕ ⊕_j 𝔤_j``).
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    d = len(basis)
    if d == 0:
        return {"labels": np.zeros(0, np.intp), "ideal_sizes": [], "centre_dimension": 0}
    step = max(1, _CHUNK_PAIRS // d)
    rows, cols = [], []
    for start in range(0, d, step):
        ii, jj = _anticommute_pairs(basis.x[start:start + step], basis.z[start:start + step], basis.x, basis.z)
        rows.append(ii + start)
        cols.append(jj)
    ii, jj = np.concatenate(rows), np.concatenate(cols)
    central = np.bincount(ii, minlength=d) == 0
    graph = coo_matrix((np.ones(len(ii), np.int8), (ii, jj)), shape=(d, d))
    _, comp = connected_components(graph, directed=False)
    labels = np.full(d, -1, np.intp)
    labels[~central] = np.unique(comp[~central], return_inverse=True)[1]
    sizes = np.bincount(labels[~central], minlength=0).tolist() if (~central).any() else []
    return {"labels": labels, "ideal_sizes": [int(v) for v in sizes], "centre_dimension": int(central.sum())}


def _term_map(observable: Sequence[tuple[float, tuple]]) -> dict[tuple[int, int], float]:
    out: dict[tuple[int, int], float] = {}
    for coeff, ops in observable:
        key = _to_ints(ops)
        out[key] = out.get(key, 0.0) + float(coeff)
    return out


def g_purities(basis_strings: PauliArray, observable: Sequence[tuple[float, tuple]], n: int) -> dict:
    """g-purities of the observable and of ``|0..0><0..0|`` w.r.t. a Pauli-string DLA basis.

    ``observable_in_algebra`` ignores the identity component (it is invisible to the variance);
    ``state_in_algebra`` means every non-identity ``{I,Z}^n`` string lies in the algebra.
    """
    all_keys = [_to_ints(ops) for _, ops in basis_strings.to_sparse()]
    basis_keys = set(all_keys)
    terms = {k: c for k, c in _term_map(observable).items() if c != 0.0 and k != (0, 0)}
    in_basis = sum(c * c for k, c in terms.items() if k in basis_keys)
    out_basis = sum(c * c for k, c in terms.items() if k not in basis_keys)
    z_type = is_z_type(basis_strings)
    z_count = int(z_type.sum())
    dec = ideal_decomposition(basis_strings)
    ideals = []
    for j, size in enumerate(dec["ideal_sizes"]):
        members = np.nonzero(dec["labels"] == j)[0]
        keys = {all_keys[int(m)] for m in members}
        ideals.append({"dimension": size, "purity_observable": float(2 ** n * sum(
            c * c for k, c in terms.items() if k in keys)), "purity_state": int(z_type[members].sum()) / 2 ** n})
    return {"purity_observable": float(2 ** n * in_basis), "purity_state": z_count / 2 ** n,
            "observable_in_algebra": bool(terms) and out_basis == 0.0,
            "state_in_algebra": z_count == 2 ** n - 1, "dimension": len(basis_strings), "n_qubits": n,
            "ideals": ideals, "centre_dimension": dec["centre_dimension"]}


def g_purities_sum(closure: dict, observable: Sequence[tuple[float, tuple]], n: int, tol: float = 1e-9) -> dict:
    """Purities for the Pauli-sum path: project onto the orthonormal coefficient basis."""
    obs = {k: c for k, c in _term_map(observable).items() if k != (0, 0)}
    inner = [sum(c * vec.get(_to_ops(*k), 0.0) for k, c in obs.items()) for vec in closure["basis"]]
    total = sum(c * c for c in obs.values())
    proj = float(sum(i * i for i in inner))
    residual = float(np.sqrt(max(total - proj, 0.0)))
    # purity of |0><0|: ‖proj of rho onto g‖² * 2^n with rho = 2^-n Σ_{z-type} S  (identity excluded)
    z_ops = [_to_ops(0, z) for z in _all_z(n) if z]
    p_state = 0.0
    for vec in closure["basis"]:
        p_state += sum(vec.get(ops, 0.0) / 2 ** n for ops in z_ops) ** 2
    return {"purity_observable": 2 ** n * proj, "purity_state": 2 ** n * p_state,
            "observable_in_algebra": residual < tol, "state_in_algebra": None, "observable_residual": residual,
            "dimension": len(closure["basis"]), "n_qubits": n}


def _all_z(n: int):
    if n > 12:
        raise ValueError("g_purities_sum is limited to n <= 12")
    return range(2 ** n)


def predicted_variance(purities: dict, dim: int) -> float | None:
    """``P_g(rho) P_g(O) / dim g`` or ``None`` when not applicable (neither operand lies in the algebra)."""
    if dim <= 0 or not (purities.get("observable_in_algebra") or purities.get("state_in_algebra")):
        return None
    return float(purities["purity_state"] * purities["purity_observable"] / dim)


def predicted_variance_reductive(purities: dict) -> float | None:
    """Ragone for ``𝔤 = 𝔷 ⊕ ⊕_j 𝔤_j``: ``Σ_j P_j(ρ) P_j(O) / dim 𝔤_j`` (centre excluded).

    ``None`` when there is no non-central ideal, or neither operand lies in the algebra.  The caller
    guarantees each ideal is simple (Pauli-string basis: components of the anticommutation graph).
    """
    ideals = purities.get("ideals") or []
    if not ideals or not (purities.get("observable_in_algebra") or purities.get("state_in_algebra")):
        return None
    return float(sum(i["purity_state"] * i["purity_observable"] / i["dimension"] for i in ideals))
