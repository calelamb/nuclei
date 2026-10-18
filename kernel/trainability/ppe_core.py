"""Pauli Propagation Engine (PPE): exact gradient variances and bounded expectations.

Setting
-------
A *rotation program* is a time-ordered list of Pauli rotations and Clifford gates
(IR independent).  A rotation is ``U = exp(-i (f/2) θ_k P)`` with an integer frequency
``f != 0`` and ``θ_k ~ U[0, 2π)`` independent per parameter.  The cost is
``C(θ) = <0..0| U† O U |0..0>`` with ``O = Σ_j c_j Q_j`` a Pauli sum.

Heisenberg step (sign convention)
---------------------------------
Propagate the observable from the last gate to the first.  For a rotation with
``φ = f θ`` and a Hermitian Pauli ``Q``::

    U† Q U = e^{iφP/2} Q e^{-iφP/2}
           = Q                                   if [P, Q] = 0
           = Q e^{-iφP} = cos φ · Q + sin φ · (i P Q)   if {P, Q} = 0,

because ``e^{iφP/2} Q = Q e^{-iφP/2}`` when ``Q`` anticommutes with ``P`` and
``QP = -PQ``.  ``iPQ`` is Hermitian (``(iPQ)† = -iQP = iPQ``) and is again ± a Pauli
string; ``σ = ±1`` denotes that sign.  Cliffords map strings to strings
(``Q -> g† Q g``).  ``_ppe_compile`` pushes all Cliffords to the end so the engine only
ever sees pure rotations about (signed) Paulis.

Second moments: the doubled chain
---------------------------------
With independent uniform angles and integer ``f != 0``::

    E[cos φ] = E[sin φ] = E[cos φ sin φ] = 0,   E[cos² φ] = E[sin² φ] = 1/2.

``E[C²]`` involves products of two propagated terms, so the natural state is a pair
``(Q, Q')`` with a real weight ``w``.  Applying one rotation, and averaging over its
(independent) angle:

* both commute with ``P``: the pair stays (weight × 1);
* both anticommute: ``(cQ + sσR)(cQ' + sσ'R')`` averages to
  ``½ (Q,Q') + ½ σσ' (R,R')`` with ``R = ±iPQ`` rendered as a string with sign;
* exactly one anticommutes: the product is ``1·(cos φ or sin φ)`` -> mean 0, the pair dies.

At the end ``E[C²] = Σ w <0|Q|0><0|Q'|0>``, nonzero only for Z-type strings (value 1).
For a single Pauli observable ``Q' = Q`` always, the chain is diagonal, weights stay
non-negative and total weight is conserved (a Markov chain).

Gradient variance
-----------------
``C`` is a trigonometric polynomial in each ``θ_k`` of degree ``|f_k|`` so
``E[∂_k C] = 0`` and ``Var[∂_k C] = E[(∂_k C)²]``.  At the (unique) rotation carrying
parameter ``k`` the single-term map is ``Q -> cos φ Q + σ sin φ R'`` and
``∂_{θ_k}`` gives ``f(-sin φ Q + σ cos φ R)``.  Hence pairs that do not both
anticommute die (they do not depend on ``θ_k``) and the surviving pairs become
``(f²/2)[(Q,Q') + σσ'(R,R')]``.  The fork is then propagated through the rest of the circuit
with the ordinary rules.  Forks of different parameters are carried in *one* tagged
frontier, so a single backward sweep serves all parameters and the shared suffix
(the main chain, before the fork) is computed once.  Constructions of this kind underlie
Napp (2022) and Letcher, Woerner & Zoufal (2023); see also Angrisani et al. (2024) for classical
estimation of noiseless observables, and Ragone et al., Nat. Commun. 15, 7172 (2024).

Exact early exits (not truncation)
----------------------------------
Let ``U_j`` be the qubits touched by rotations with index ``< j`` (the rotations still to
come).  A string with an X/Y outside ``U_j`` can never lose it, so ``<0|Q|0> = 0``: the
row is dropped exactly.  A string whose support is disjoint from ``U_j`` is untouched by
all remaining rotations: it is finalized (value 1, being Z-type).  Parameters whose
rotation no surviving pair anticommutes with get variance exactly 0 ("dead", the
backward light cone argument).

Truncation with rigorous intervals
----------------------------------
Rows are pruned by ``max_weight``, ``min_weight_abs`` and ``max_frontier``; the discarded
``Σ|w|`` is recorded per tag.  A row of weight ``w`` contributes at most ``|w|`` to the final
sum (the doubled chain never increases total absolute weight, and a Pauli expectation has
modulus ≤ 1).  A main-chain row discarded before the fork of ``k`` contributes at most
``f_k² |w|`` to that fork.  Therefore, with ``D_k = f_k² D_main(at fork k) + D_fork,k``::

    diagonal (single Pauli observable): Var_k ∈ [kept, kept + D_k]   (all terms ≥ 0)
    pair chain with signed weights:     Var_k ∈ [max(0, kept - D_k), kept + D_k]

For fixed parameters, ``<O>`` uses a single chain with weights ``cos φ`` / ``σ sin φ``;
each discarded row contributes at most ``|w|``, so ``<O> ∈ [kept - D, kept + D]``.
Hitting the time budget (or cancellation) stops the sweep; all remaining mass is moved to
the discarded total so intervals stay valid.  ``method`` is ``"..._exact"`` only if nothing
was discarded and the sweep completed.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np

from ._ppe_compile import CompiledProgram, compile_program
from ._ppe_types import CliffordGate, Ops, PauliRotation, RotationProgram  # noqa: F401
from ._symplectic_keys import group_rows
from .symplectic import PauliArray, multiply, popcount

Observable = Sequence[tuple[float, Ops]]
_EXACT, _BOUNDED = "pauli_propagation_exact", "pauli_propagation_bounded"


# ---------------------------------------------------------------------------
# frontier primitives
# ---------------------------------------------------------------------------
def _anti(px: np.ndarray, pz: np.ndarray, qx: np.ndarray, qz: np.ndarray) -> np.ndarray:
    t = (px & qz) ^ (pz & qx)
    folded = np.bitwise_xor.reduce(t, axis=1)
    return (popcount(folded[:, None]) & 1).astype(bool)


def _product_with_rotation(comp: CompiledProgram, j: int, qx: np.ndarray, qz: np.ndarray):
    """Strings and signs of ``i P Q`` for anticommuting rows (``P`` = signed rotation Pauli j)."""
    n = comp.n_qubits
    phase = np.array([0 if comp.rot_sign[j] > 0 else 2], dtype=np.uint8)
    p = PauliArray(n, comp.rot_x[j][None], comp.rot_z[j][None], phase)
    q = PauliArray(n, qx, qz, np.zeros(len(qx), np.uint8))
    prod = multiply(p, q)
    sgn = 1.0 - 2.0 * (((prod.phase.astype(np.int64) + 1) & 3) == 2)
    return prod.x, prod.z, sgn


@dataclass
class _Chain:
    """Frontier of (pairs of) Pauli strings with weights; ``rx is None`` for a diagonal chain."""

    qx: np.ndarray
    qz: np.ndarray
    rx: np.ndarray | None
    rz: np.ndarray | None
    w: np.ndarray
    tag: np.ndarray  # int32; -1 = main chain, k >= 0 = fork of parameter k

    def __len__(self) -> int:
        return int(self.w.shape[0])

    @property
    def diag(self) -> bool:
        return self.rx is None

    def select(self, idx) -> "_Chain":
        return _Chain(self.qx[idx], self.qz[idx], None if self.diag else self.rx[idx],
                      None if self.diag else self.rz[idx], self.w[idx], self.tag[idx])

    @staticmethod
    def empty_like(c: "_Chain") -> "_Chain":
        return c.select(np.zeros(0, dtype=np.intp))

    @staticmethod
    def concat(parts: Sequence["_Chain"]) -> "_Chain":
        first = parts[0]
        cat = np.concatenate
        return _Chain(cat([p.qx for p in parts]), cat([p.qz for p in parts]),
                      None if first.diag else cat([p.rx for p in parts]),
                      None if first.diag else cat([p.rz for p in parts]),
                      cat([p.w for p in parts]), cat([p.tag for p in parts]))

    def merged(self) -> "_Chain":
        if len(self) <= 1:
            return self
        cols = [self.qx, self.qz] + ([] if self.diag else [self.rx, self.rz])
        cols.append((self.tag.astype(np.int64) + 1).astype(np.uint64)[:, None])
        first, inverse = group_rows(np.concatenate(cols, axis=1))
        if len(first) == len(self):
            return self
        w = np.bincount(inverse, weights=self.w, minlength=len(first))
        out = self.select(first)
        out.w = w
        return out


def _filter_exact(chain: _Chain, union: np.ndarray, final: np.ndarray, count_main: bool = False) -> _Chain:
    """Drop rows that are exactly zero and finalize untouched rows (see module docstring)."""
    if len(chain) == 0:
        return chain
    outside = ~union
    dead = ((chain.qx & outside) != 0).any(axis=1)
    done = ~((chain.qx | chain.qz) & union).any(axis=1)
    if not chain.diag:
        dead |= ((chain.rx & outside) != 0).any(axis=1)
        done &= ~((chain.rx | chain.rz) & union).any(axis=1)
    done &= ~dead
    if done.any():
        sel = done if count_main else done & (chain.tag >= 0)
        final += np.bincount(chain.tag[sel] + 1, weights=chain.w[sel], minlength=len(final))
    return chain.select(~(dead | done))


class _Limits:
    def __init__(self, max_weight, min_weight_abs, max_frontier, time_budget_s, cancel, progress):
        self.max_weight, self.min_abs, self.max_frontier = max_weight, float(min_weight_abs), int(max_frontier)
        self.deadline = time.perf_counter() + float(time_budget_s)
        self.cancel, self.progress = cancel, progress

    def stop_reason(self) -> str | None:
        if self.cancel is not None and self.cancel():
            return "cancelled"
        if time.perf_counter() > self.deadline:
            return "budget_exhausted"
        return None


def _prune(chain: _Chain, lim: _Limits, disc: np.ndarray) -> _Chain:
    """Apply truncation rules; discarded ``|w|`` is accumulated per tag in ``disc[tag + 1]``."""
    if len(chain) == 0:
        return chain
    absw = np.abs(chain.w)
    drop = absw < lim.min_abs
    if lim.max_weight is not None:
        drop |= popcount(chain.qx | chain.qz) > lim.max_weight
        if not chain.diag:
            drop |= popcount(chain.rx | chain.rz) > lim.max_weight
    if drop.any():
        disc += np.bincount(chain.tag[drop] + 1, weights=absw[drop], minlength=len(disc))
        chain, absw = chain.select(~drop), absw[~drop]
    if len(chain) > lim.max_frontier:
        keep = np.argpartition(-absw, lim.max_frontier - 1)[: lim.max_frontier]
        mask = np.zeros(len(chain), dtype=bool)
        mask[keep] = True
        disc += np.bincount(chain.tag[~mask] + 1, weights=absw[~mask], minlength=len(disc))
        chain = chain.select(mask)
    return chain


# ---------------------------------------------------------------------------
# gradient variances
# ---------------------------------------------------------------------------
def _initial_chain(comp: CompiledProgram) -> _Chain:
    k = len(comp.obs_w)
    if k == 1:
        return _Chain(comp.obs.x.copy(), comp.obs.z.copy(), None, None, comp.obs_w ** 2, np.full(1, -1, np.int32))
    ii, jj = np.meshgrid(np.arange(k), np.arange(k), indexing="ij")
    ii, jj = ii.ravel(), jj.ravel()
    return _Chain(comp.obs.x[ii], comp.obs.z[ii], comp.obs.x[jj], comp.obs.z[jj], comp.obs_w[ii] * comp.obs_w[jj],
                  np.full(k * k, -1, np.int32))


def _variance_step(comp: CompiledProgram, j: int, ch: _Chain) -> tuple[_Chain, bool]:
    """One backward rotation step; returns the new chain and whether the fork had seeds."""
    px, pz = comp.rot_x[j], comp.rot_z[j]
    k_param, f2 = int(comp.rot_param[j]), float(comp.rot_freq[j]) ** 2
    a1 = _anti(px, pz, ch.qx, ch.qz)
    a2 = a1 if ch.diag else _anti(px, pz, ch.rx, ch.rz)
    keep, both = ~a1 & ~a2, np.nonzero(a1 & a2)[0]
    parts = [ch.select(keep)]
    seeded = False
    if both.size:
        sub = ch.select(both)
        fx, fz, s1 = _product_with_rotation(comp, j, sub.qx, sub.qz)
        if ch.diag:
            gx, gz, pair_sign = None, None, np.ones(len(sub))
        else:
            gx, gz, s2 = _product_with_rotation(comp, j, sub.rx, sub.rz)
            pair_sign = s1 * s2
        stay = _Chain(sub.qx, sub.qz, sub.rx, sub.rz, 0.5 * sub.w, sub.tag)
        flip = _Chain(fx, fz, gx, gz, 0.5 * sub.w * pair_sign, sub.tag)
        parts += [stay, flip]
        main = np.nonzero(sub.tag == -1)[0]
        if main.size:
            seeded = True
            for half in (stay, flip):
                seed = half.select(main)
                seed.w = seed.w * f2
                seed.tag = np.full(len(seed), k_param, np.int32)
                parts.append(seed)
    out = _Chain.concat(parts) if len(parts) > 1 else parts[0]
    return (out.merged() if both.size else out), seeded


def gradient_variances(program: RotationProgram, n_qubits: int, n_params: int, observable: Observable, *,
                       max_weight: int | None = None, min_weight_abs: float = 1e-12,
                       max_frontier: int = 2_000_000, time_budget_s: float = 20.0,
                       progress: Callable[[float, str], None] | None = None,
                       cancel: Callable[[], bool] | None = None) -> dict:
    """Exact ``Var_θ[∂C/∂θ_k]`` for every parameter via the tagged doubled chain (see module doc)."""
    t0 = time.perf_counter()
    comp = compile_program(program, n_qubits, n_params, observable)
    seen: dict[int, int] = {}
    for pos, par in enumerate(comp.rot_param):
        if int(par) in seen:
            raise ValueError(f"parameter {int(par)} drives more than one rotation; parameters must be independent")
        seen[int(par)] = pos
    lim = _Limits(max_weight, min_weight_abs, max_frontier, time_budget_s, cancel, progress)
    n_rot = comp.n_rot
    disc = np.zeros(n_params + 1)           # discarded |w| per tag (index tag + 1)
    final = np.zeros(n_params + 1)
    launch_d = np.zeros(n_params)           # D_main when fork k was launched
    launched = np.zeros(n_params, dtype=bool)
    seeded = np.zeros(n_params, dtype=bool)
    chain = _filter_exact(_prune(_initial_chain(comp), lim, disc), comp.union_before[n_rot], final) \
        if len(comp.obs_w) else None
    peak = len(chain) if chain is not None else 0
    status, j = "complete", n_rot - 1
    while chain is not None and j >= 0:
        reason = lim.stop_reason()
        if reason:
            status = reason
            break
        if len(chain) == 0:
            break
        k = int(comp.rot_param[j])
        launched[k], launch_d[k] = True, disc[0]
        chain, seeded[k] = _variance_step(comp, j, chain)
        chain = _filter_exact(_prune(chain, lim, disc), comp.union_before[j], final)
        peak = max(peak, len(chain))
        if progress is not None:
            progress((n_rot - j) / max(n_rot, 1), f"rotation {n_rot - j}/{n_rot}, frontier {len(chain)}")
        j -= 1
    remaining = _remaining_mass(chain, n_params)
    return _assemble_variances(comp, n_params, final, disc, launch_d, launched, seeded, remaining,
                               status, peak, t0, chain is None or chain.diag)


def _remaining_mass(chain: _Chain | None, n_params: int) -> np.ndarray:
    if chain is None or len(chain) == 0:
        return np.zeros(n_params + 1)
    return np.bincount(chain.tag + 1, weights=np.abs(chain.w), minlength=n_params + 1)


def _assemble_variances(comp, n_params, final, disc, launch_d, launched, seeded, remaining, status, peak, t0,
                        diag) -> dict:
    f2 = np.zeros(n_params)
    rot_of = {int(p): i for i, p in enumerate(comp.rot_param)}
    for p, i in rot_of.items():
        f2[p] = comp.rot_freq[i] ** 2
    complete = status == "complete"
    rows, lows, highs = [], [], []
    for k in range(n_params):
        if k not in rot_of:
            lo = hi = est = 0.0
            dead, reason = True, "unused_parameter"
        else:
            if launched[k]:
                d_k = f2[k] * launch_d[k] + disc[k + 1] + remaining[k + 1]
                kept = float(final[k + 1])
            else:  # sweep stopped (or chain emptied) before reaching this rotation
                d_k = f2[k] * (disc[0] + remaining[0])
                kept = 0.0
            hi = kept + d_k
            lo = kept if diag else kept - d_k
            lo = max(lo, 0.0)
            est = min(max(kept, lo), hi) if complete else 0.5 * (lo + hi)
            dead = lo == 0.0 and hi == 0.0
            reason = "light_cone" if dead and not seeded[k] else ("annihilated" if dead else None)
        rows.append({"param": k, "variance": float(est), "interval": [float(lo), float(hi)], "dead": bool(dead),
                     "dead_reason": reason})
        lows.append(lo)
        highs.append(hi)
    n = max(n_params, 1)
    mean = float(np.mean([r["variance"] for r in rows])) if rows else 0.0
    total_disc = float(disc.sum() + remaining.sum()) if not complete else float(disc.sum())
    exact = complete and disc.sum() == 0.0
    return {"method": _EXACT if exact else _BOUNDED, "per_parameter": rows, "variance_mean": mean,
            "variance_mean_interval": [float(sum(lows) / n), float(sum(highs) / n)], "frontier_peak": int(peak),
            "discarded_mass": total_disc, "elapsed_ms": (time.perf_counter() - t0) * 1e3, "status": status}


# ---------------------------------------------------------------------------
# expectation at fixed parameters
# ---------------------------------------------------------------------------
def expectation_bounds(program: RotationProgram, n_qubits: int, observable: Observable, values: np.ndarray, *,
                       max_weight: int | None = None, min_weight_abs: float = 1e-12, max_frontier: int = 2_000_000,
                       time_budget_s: float = 20.0, cancel: Callable[[], bool] | None = None) -> dict:
    """``<O>`` at fixed parameter ``values`` with a rigorous interval ``[kept - D, kept + D]``."""
    t0 = time.perf_counter()
    values = np.asarray(values, dtype=float)
    comp = compile_program(program, n_qubits, len(values), observable)
    lim = _Limits(max_weight, min_weight_abs, max_frontier, time_budget_s, cancel, None)
    disc, final = np.zeros(1), np.zeros(1)
    k = len(comp.obs_w)
    chain = _Chain(comp.obs.x.copy(), comp.obs.z.copy(), None, None, comp.obs_w.copy(), np.full(k, -1, np.int32))
    chain = _filter_exact(_prune(chain, lim, disc), comp.union_before[comp.n_rot], final, True)
    peak, status, j = len(chain), "complete", comp.n_rot - 1
    while j >= 0 and len(chain):
        reason = lim.stop_reason()
        if reason:
            status = reason
            break
        chain = _expectation_step(comp, j, chain, values)
        chain = _filter_exact(_prune(chain, lim, disc), comp.union_before[j], final, True)
        peak = max(peak, len(chain))
        j -= 1
    lost = float(disc[0] + (np.abs(chain.w).sum() if len(chain) else 0.0))
    value = float(final[0])
    return {"value": value, "interval": [value - lost, value + lost], "frontier_peak": int(peak),
            "discarded_mass": lost, "method": _EXACT if lost == 0.0 and status == "complete" else _BOUNDED,
            "status": status, "elapsed_ms": (time.perf_counter() - t0) * 1e3}


def _expectation_step(comp: CompiledProgram, j: int, ch: _Chain, values: np.ndarray) -> _Chain:
    anti = _anti(comp.rot_x[j], comp.rot_z[j], ch.qx, ch.qz)
    if not anti.any():
        return ch
    phi = comp.rot_freq[j] * values[comp.rot_param[j]]
    cos, sin = np.cos(phi), np.sin(phi)
    sub = ch.select(np.nonzero(anti)[0])
    fx, fz, sgn = _product_with_rotation(comp, j, sub.qx, sub.qz)
    stay = _Chain(sub.qx, sub.qz, None, None, sub.w * cos, sub.tag)
    flip = _Chain(fx, fz, None, None, sub.w * sgn * sin, sub.tag)
    return _Chain.concat([ch.select(~anti), stay, flip]).merged()


def frontier_curve(program: RotationProgram, n_qubits: int, observable: Observable, values: np.ndarray, *,
                   frontier_sizes: Sequence[int], **budget) -> list[dict]:
    """Interval width of ``<O>`` versus ``max_frontier`` (the "estimation hardness" probe)."""
    out = []
    for size in frontier_sizes:
        res = expectation_bounds(program, n_qubits, observable, values, **{**budget, "max_frontier": int(size)})
        out.append({"max_frontier": int(size), "value": res["value"], "interval": res["interval"],
                    "width": res["interval"][1] - res["interval"][0], "frontier_peak": res["frontier_peak"],
                    "discarded_mass": res["discarded_mass"], "method": res["method"],
                    "elapsed_ms": res["elapsed_ms"]})
    return out
