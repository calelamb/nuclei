"""Dynamical Lie algebra analysis of a parameterized circuit (spec 5.5, ``lie_algebra``).

Setting
-------
A circuit ``U(v) = Π_k exp(-i a_k v_k G_k) · (fixed gates)`` generates the Lie group whose algebra
``𝔤 = <i G~_1, ..., i G~_m>_Lie`` (the *dynamical Lie algebra*, DLA) controls trainability.

Effective generators
--------------------
Fixed gates are pushed to the end of the circuit.  If ``V_k`` is the product of the fixed gates
*before* rotation ``k``, then ``R_k(G) V_k = V_k R_k(V_k† G V_k)``, so::

    U = V_final · Π_k exp(-i a_k v_k G~_k),     G~_k = V_k† G_k V_k,     O~ = V_final† O V_final,

and the cost is ``<0|U† O U|0> = <0|(Π exp)† O~ (Π exp)|0>``.  With Clifford-only fixed gates
this is exact symbolic Pauli conjugation (``CliffordFrame``, incremental, scales to n = 20 and
beyond).  Gates that share a parameter ``v`` form *one* generator, the sum
``Σ a_k G~_k`` (they are driven by the same angle).  With non-Clifford fixed gates the dense
fallback is used for ``n <= 6`` (no purities), otherwise the result is ``unsupported``.

Closure paths
-------------
* every effective generator a single Pauli string: the closure is a set of strings
  (``pauli_string_closure``; ``[P, Q] = 2PQ`` for anticommuting strings);
* otherwise (multi-Pauli generators such as CRZ/CP, or shared parameters whose gates map to
  different strings): the Pauli-sum path (``pauli_sum_closure``, Gram-Schmidt, tol 1e-9).

Classification, g-purities, prediction
--------------------------------------
Classification is by exact dimension match only (``classify_dimension``).  With
``B_j = P_j/√2^n``, ``P_𝔤(O) = 2^n Σ_{P∈𝔤} |c_P|²`` and ``P_𝔤(|0><0|) = #{P ∈ 𝔤 ∩ {I,Z}^n}/2^n``.  The
Ragone et al. (Nat. Commun. 15, 7172 (2024)) formula ``Var_cost = P_𝔤(ρ) P_𝔤(O)/dim 𝔤`` is the
variance of the **cost** over the group (not of one gradient component) in the deep-circuit
limit for simple 𝔤.  It is flagged applicable only if the closure is complete, 𝔤 is not
abelian (an abelian 𝔤 is far from a 2-design: e.g. one ``Z`` generator gives dim 1 and zero
variance), and the observable or the state lies in 𝔤.

``elapsed_ms`` is the only run-dependent field; everything else is deterministic.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np

from kernel.trainability import lie_core
from kernel.trainability._analysis_common import AnalysisError, Cancel, check_cancel, observable_terms
from kernel.trainability._circuit_walk import FixedClifford, FixedOther, Rotation, walk
from kernel.trainability._lie_dense import DENSE_MAX_QUBITS, dense_closure_budgeted, effective_generators_dense
from kernel.trainability._ppe_compile import ints_to_words, ops_to_ints
from kernel.trainability._symplectic_frame import CliffordFrame
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.symplectic import PauliArray, anticommute_matrix

__all__ = ["lie_algebra", "ints_to_ops", "generator_label"]

_COEFF_TOL = 1e-12
_IN_ALGEBRA_TOL = 1e-9
_ABELIAN_CHECK_LIMIT = 400
_LETTER = {(1, 0): "X", (0, 1): "Z", (1, 1): "Y"}
_GOH = "𝔤-sim, Goh et al. 2023 (arXiv:2308.01432)"

Gen = dict  # {(x, z): float}


def ints_to_ops(x: int, z: int) -> tuple[tuple[int, str], ...]:
    both, out = x | z, []
    while both:
        low = both & -both
        q = low.bit_length() - 1
        both ^= low
        out.append((q, _LETTER[((x >> q) & 1, (z >> q) & 1)]))
    return tuple(out)


def generator_label(ops: tuple[tuple[int, str], ...]) -> str:
    return "".join(f"{p}{q}" for q, p in ops) or "I"


def _gen_label(gen: Gen) -> str:
    keys = sorted(gen, key=lambda k: (bin(k[0] | k[1]).count("1"), ints_to_ops(*k)))
    shown = [generator_label(ints_to_ops(*k)) for k in keys[:3]]
    return " + ".join(shown) + (" + …" if len(keys) > 3 else "")


# ------------------------------------------------------------- effective gens
def _effective_clifford(items, n: int) -> tuple[list[tuple[str, Gen]], CliffordFrame]:
    frame = CliffordFrame(n)
    acc: dict[str, Gen] = {}
    for item in items:
        if isinstance(item, FixedClifford):
            for name in item.names:
                frame.append(name, item.qubits)
        elif isinstance(item, Rotation):
            g = acc.setdefault(item.ref.name, {})
            for coeff, ops in item.terms:
                x, z = ops_to_ints(ops, n)
                x2, z2, s = frame.map_string(x, z)
                g[(x2, z2)] = g.get((x2, z2), 0.0) + item.ref.coeff * coeff * s
    gens = []
    for name, g in acc.items():
        g = {k: c for k, c in g.items() if abs(c) > _COEFF_TOL}
        if g:
            gens.append((name, g))
    return gens, frame


def _conjugate_observable(observable, frame: CliffordFrame, n: int) -> list[tuple[float, tuple]]:
    out = []
    for coeff, ops in observable_terms(observable):
        x, z = ops_to_ints(ops, n)
        x2, z2, s = frame.map_string(x, z)
        out.append((coeff * s, ints_to_ops(x2, z2)))
    return out


def _canonical_key(g: Gen) -> tuple:
    keys = sorted(g)
    lead = g[keys[0]]
    return tuple((k, round(g[k] / lead, 9)) for k in keys)


# ------------------------------------------------------------------- closures
def _string_array(gens: list[Gen], n: int) -> PauliArray:
    out = PauliArray.identity(n, len(gens))
    w = out.x.shape[1]
    for i, g in enumerate(gens):
        (x, z), = g.keys()
        out.x[i], out.z[i] = ints_to_words(x, w), ints_to_words(z, w)
    return out


def _sum_purities(basis: list[dict], obs_terms: list[tuple[float, tuple]], n: int) -> dict:
    """g-purities on the Pauli-sum path (no enumeration of the 2^n Z-strings)."""
    obs = {}
    for coeff, ops in obs_terms:
        k = ops_to_ints(ops, n)
        if k != (0, 0):
            obs[k] = obs.get(k, 0.0) + coeff
    total = sum(c * c for c in obs.values())
    proj = state_proj = 0.0
    r = 2.0 ** -n
    for vec in basis:
        v = {ops_to_ints(ops, n): c for ops, c in vec.items()}
        proj += sum(c * v.get(k, 0.0) for k, c in obs.items()) ** 2
        state_proj += (r * sum(c for (x, z), c in v.items() if x == 0 and (x, z) != (0, 0))) ** 2
    state_total = (2.0 ** n - 1.0) * r * r
    residual = float(np.sqrt(max(total - proj, 0.0)))
    return {
        "purity_observable": float(2.0 ** n * proj), "purity_state": float(2.0 ** n * state_proj),
        "observable_in_algebra": bool(obs) and residual < _IN_ALGEBRA_TOL * max(1.0, np.sqrt(total)),
        "state_in_algebra": bool((state_total - state_proj) / state_total < _IN_ALGEBRA_TOL),
    }


def _is_abelian(gens: list[Gen], dim: int, n: int) -> bool:
    uniq = {_canonical_key(g) for g in gens}
    if dim > len(uniq):
        return False
    if len(gens) > _ABELIAN_CHECK_LIMIT:
        return False
    for i, a in enumerate(gens):
        for b in gens[i + 1:]:
            if lie_core._herm_bracket(a, b):  # noqa: SLF001 - wave-1 helper, tested there
                return False
    return True


# --------------------------------------------------------------- result pieces
def _classification(status: str, dim: int | None, n: int) -> dict:
    if status != "complete" or dim is None:
        return {"label": "unknown", "family": "unknown", "confidence": "none",
                "note": "The closure did not finish, so the algebra cannot be named."}
    out = lie_core.classify_dimension(dim, n)
    return {k: out[k] for k in ("label", "family", "confidence", "note")}


def _membership(purity: dict | None) -> str:
    if not purity or purity.get("observable_in_algebra") is None:
        return ""
    yes = lambda v: "yes" if v else "no"  # noqa: E731
    return (f" Observable in 𝔤: {yes(purity['observable_in_algebra'])}; "
            f"initial state in 𝔤: {yes(purity['state_in_algebra'])}.")


def _simulability(status: str, dim: int | None, lower: int | None, n: int, cls: dict,
                  purity: dict | None) -> dict:
    cap = 4 * n * n
    if status == "unsupported":
        return {"kind": "unknown", "summary": "The DLA could not be computed for this circuit."}
    if status != "complete" or dim is None:
        return {"kind": "unknown", "summary": (
            f"The closure was truncated at dim 𝔤 ≥ {lower}; the full dimension is unknown, so no simulability "
            "claim is made.")}
    if dim <= cap:
        what = (f" = n(2n−1): free-fermion algebra {cls['label']}" if cls["family"] == "free_fermion"
                else (f" = {cls['label']}" if cls["family"] != "other" else ""))
        return {"kind": "g_sim_feasible", "summary": (
            f"dim 𝔤 = {dim}{what} (≤ 4n² = {cap}). Expectations are classically simulable in poly(dim 𝔤) "
            f"time when the observable or the initial state lies in 𝔤 ({_GOH}).{_membership(purity)}")}
    if cls["family"] in ("su", "so", "sp"):
        return {"kind": "exponential_dla", "summary": (
            f"dim 𝔤 = {dim} = {cls['label']} (exponential in n): 𝔤-sim is not efficient and the cost "
            "concentrates exponentially for deep circuits (Ragone et al. 2024).")}
    return {"kind": "unknown", "summary": (
        f"dim 𝔤 = {dim} > 4n² = {cap} and not a named full algebra: 𝔤-sim is not guaranteed efficient.")}


def _assumptions(path: str, complete: bool, shared: bool) -> list[str]:
    out = ["Deep-circuit regime: the circuit is an approximate 2-design over e^𝔤 (not guaranteed for shallow circuits).",
           "𝔤 treated as simple; for reductive 𝔤 this is the leading term.",
           "The predicted quantity is the variance of the cost C over the group, not of a single gradient component.",
           "Initial state |0…0⟩; fixed gates are pushed to the end of the circuit."]
    if shared:
        out.append("Gates sharing one parameter form one generator (the sum of their conjugated generators).")
    if path == "dense":
        out.append("Dense fallback (non-Clifford fixed gates): g-purities and the variance prediction are not computed.")
    if not complete:
        out.append("The closure did not finish: dimension is only a lower bound.")
    return out


def _empty_result(circuit: ParamCircuit, max_dimension: int, t0: float, fixed: dict) -> dict:
    return _assemble(circuit.n_qubits, max_dimension, {"status": "complete", "dimension": 0,
                     "dimension_lower_bound": 0, "reason": None}, [], fixed, None, "none", False, t0)


def _assemble(n, max_dimension, closure, gens, fixed, purity, path, shared, t0, abelian=False,
              prediction=None, obs_given=False) -> dict:
    status = closure["status"]
    dim = closure["dimension"] if status == "complete" else None
    lower = closure.get("dimension_lower_bound")
    cls = _classification(status, dim, n)
    if status == "complete" and dim == 0:
        cls = {"label": "trivial", "family": "other", "confidence": "exact_dimension_match",
               "note": "No parameterized generators."}
    sim = _simulability(status, dim, lower, n, cls, purity)
    uniq = {_canonical_key(g) for g in gens}
    examples, seen = [], set()
    for g in gens:
        key = _canonical_key(g)
        if key not in seen and len(examples) < 4:
            seen.add(key)
            examples.append(_gen_label(g))
    return {
        "status": status, "reason": closure.get("reason"), "n_qubits": n,
        "dimension": dim, "dimension_lower_bound": lower, "max_dimension": max_dimension,
        "classification": cls, "path": path,
        "generators": {"count": len(gens), "unique": len(uniq), "examples": examples},
        "fixed_gates": fixed,
        "purity": purity if purity is not None else {
            "initial_state": None, "observable": None, "observable_in_algebra": None, "state_in_algebra": None},
        "predicted_variance": prediction[0] if prediction else None,
        "prediction_applicable": bool(prediction and prediction[1]),
        "prediction_quantity": "cost_variance",
        "abelian": abelian if status == "complete" else None,
        "assumptions": _assumptions(path, status == "complete", shared),
        "simulability": sim,
        "elapsed_ms": int(round((time.perf_counter() - t0) * 1e3)),
    }


# ---------------------------------------------------------------------- main
def _prediction(purity: dict, dim: int, abelian: bool) -> tuple[float | None, bool]:
    if abelian or dim <= 0:
        return None, False
    pred = lie_core.predicted_variance(
        {"purity_state": purity["initial_state"], "purity_observable": purity["observable"],
         "observable_in_algebra": purity["observable_in_algebra"], "state_in_algebra": purity["state_in_algebra"]},
        dim)
    return pred, pred is not None


def _closure_clifford(gens: list[Gen], n, max_dimension, time_budget_s, cancel) -> tuple[dict, str]:
    if all(len(g) == 1 for g in gens):
        res = lie_core.pauli_string_closure(_string_array(gens, n), max_dimension=max_dimension,
                                            time_budget_s=time_budget_s, cancel=cancel)
        return res, "pauli_strings"
    res = lie_core.pauli_sum_closure(gens, n_qubits=n, max_dimension=max_dimension,
                                     time_budget_s=time_budget_s, cancel=cancel)
    return res, "pauli_sums"


def lie_algebra(
    circuit: ParamCircuit,
    *,
    observable=None,
    max_dimension: int = 4096,
    time_budget_s: float = 10.0,
    cancel: Cancel | None = None,
) -> dict[str, Any]:
    """DLA dimension, classification, g-purities, variance prediction and simulability.

    Returns the spec's ``lie_algebra`` object plus ``path`` (``pauli_strings`` | ``pauli_sums`` |
    ``dense`` | ``none``), ``prediction_quantity`` (always ``"cost_variance"``) and ``abelian``.
    ``dimension`` is ``None`` unless ``status == "complete"`` (then ``dimension_lower_bound`` is the
    size reached).  Raises :class:`AnalysisCancelled` on cancel.
    """
    t0 = time.perf_counter()
    n = circuit.n_qubits
    if observable is not None and observable.max_qubit() >= n:
        raise AnalysisError("invalid_observable", "the observable touches qubits outside the circuit")
    items = walk(circuit)
    has_other = any(isinstance(i, FixedOther) for i in items)
    has_fixed = any(isinstance(i, (FixedClifford, FixedOther)) for i in items)
    fixed = {"clifford": not has_other,
             "handled_by": "none" if not has_fixed else ("dense" if has_other else "clifford_conjugation")}
    if not any(isinstance(i, Rotation) for i in items):
        return _empty_result(circuit, max_dimension, t0, fixed)
    shared = len({i.ref.name for i in items if isinstance(i, Rotation)}) < sum(isinstance(i, Rotation) for i in items)
    if has_other:
        return _dense(items, circuit, observable, max_dimension, time_budget_s, cancel, fixed, shared, t0)
    gens_named, frame = _effective_clifford(items, n)
    gens = [g for _, g in gens_named]
    if not gens:
        return _empty_result(circuit, max_dimension, t0, fixed)
    check_cancel(cancel)
    closure, path = _closure_clifford(gens, n, max_dimension, time_budget_s, cancel)
    if closure["reason"] == "cancelled":
        check_cancel(lambda: True)
    obs_terms = _conjugate_observable(observable, frame, n) if observable is not None else []
    purity, pred, abelian = None, None, False
    if closure["status"] == "complete":
        raw = (lie_core.g_purities(closure["basis"], obs_terms, n) if path == "pauli_strings"
               else _sum_purities(closure["basis"], obs_terms, n))
        purity = {"initial_state": raw["purity_state"],
                  "observable": raw["purity_observable"] if observable is not None else None,
                  "observable_in_algebra": raw["observable_in_algebra"] if observable is not None else None,
                  "state_in_algebra": raw["state_in_algebra"]}
        abelian = _is_abelian(gens, closure["dimension"], n)
        pred = _prediction(purity, closure["dimension"], abelian) if observable is not None else None
    return _assemble(n, max_dimension, closure, gens, fixed, purity, path, shared, t0, abelian, pred)


def _dense(items, circuit, observable, max_dimension, time_budget_s, cancel, fixed, shared, t0) -> dict:
    n = circuit.n_qubits
    if n > DENSE_MAX_QUBITS:
        res = {"status": "unsupported", "reason": (
            f"non-Clifford fixed gates need the dense fallback, which is limited to {DENSE_MAX_QUBITS} qubits"),
            "n_qubits": n, "dimension": None, "dimension_lower_bound": None, "max_dimension": max_dimension,
            "classification": _classification("unsupported", None, n), "path": "dense",
            "generators": {"count": 0, "unique": 0, "examples": []}, "fixed_gates": fixed,
            "purity": {"initial_state": None, "observable": None, "observable_in_algebra": None,
                       "state_in_algebra": None},
            "predicted_variance": None, "prediction_applicable": False, "prediction_quantity": "cost_variance",
            "abelian": None, "assumptions": _assumptions("dense", False, shared),
            "simulability": _simulability("unsupported", None, None, n, {}, None),
            "elapsed_ms": int(round((time.perf_counter() - t0) * 1e3))}
        return res
    mats = [m for _, m in effective_generators_dense(items, n)]
    closure = dense_closure_budgeted(mats, max_dimension=max_dimension, time_budget_s=time_budget_s, cancel=cancel)
    if closure["reason"] == "cancelled":
        check_cancel(lambda: True)
    gens = [{(i, 0): 1.0} for i in range(len(mats))]  # placeholders: only count/unique are reported
    out = _assemble(n, max_dimension, closure, gens, fixed, None, "dense", shared, t0)
    out["generators"] = {"count": len(mats), "unique": len(mats), "examples": []}
    return out
