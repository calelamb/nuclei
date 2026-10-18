"""The trainability term of ``trainability_frontier``: scaling verdict and exponent, one penalty scale.

What is fitted
--------------
``Var[dC/dtheta]`` (mean over parameters, exact PPE) of the *term-normalised* observable (see
``_frontier_observable``) versus ``n``, by ``kernel.trainability.scaling.fit_scaling``: an
exponential model ``2^(-beta n)`` and a power law ``n^(-alpha)``, weighted by the PPE intervals.
Only *informative* points enter the fit (a value, a positive lower bound, ``hi/lo <= 2``): a point
whose run was stopped or whose interval is wide is not a variance and never becomes one.

The penalty (PH-M2)
-------------------
Both models are reduced to one scale, **bits of variance lost per doubling of n at the largest
scored size** (``decay_per_doubling``, D):

* power law preferred: ``D = alpha_upper95`` (``n^-alpha`` loses ``alpha`` bits per doubling);
* exponential preferred: ``D = beta_upper95 * n_max / 2`` (``2^(-beta n)`` loses ``beta n_max/2``
  bits going from ``n_max/2`` to ``n_max``);
* verdict ``inconclusive`` (or both models indistinguishable): the larger of the two, so a wide
  interval is never read as good news.

The trainability term is ``-min(D, TRAIN_PENALTY_CAP)``. A shallow circuit with a flat variance
earns ~0, a ``1/n`` law -1, and an exponential concentration is cut off at ``-TRAIN_PENALTY_CAP``
(6, i.e. 64x per doubling), which outweighs the maximum hardness bonus (0.5 weight x ~5.3).
With fewer than 4 informative sizes (the ``screen`` stage) a pessimistic *secant* over the
interval extremes is used and labelled ``fit_method: "secant"`` with ``beta_ci95: null``: a
two-point slope has no confidence interval, and none is shown.
"""

from __future__ import annotations

import math
from typing import Any

from kernel.discovery.evaluators._frontier_probe import VARIANCE_FLOOR, is_informative_point
from kernel.trainability.scaling import fit_scaling

TRAIN_PENALTY_CAP = 6.0
#: ``beta`` reported when no usable fit exists (one bit per qubit: the steepest plausible decay).
BETA_UNAVAILABLE = 1.0


def _log2(value: float) -> float:
    return math.log2(max(value, VARIANCE_FLOOR))


def _secant(points: list[dict[str, Any]], n_max: int, reason: str) -> dict[str, Any]:
    """Pessimistic two-end secant: smallest-n upper bound against largest-n lower bound."""
    first, last = points[0], points[-1]
    span = float(last["n_qubits"] - first["n_qubits"])
    beta = (_log2(first["variance"]) - _log2(last["variance"])) / span
    worst = (_log2(first["variance_ci95"][1]) - _log2(last["variance_ci95"][0])) / span
    best = (_log2(first["variance_ci95"][0]) - _log2(last["variance_ci95"][1])) / span
    depth = max(worst, 0.0) * n_max / 2.0
    return {
        "fit_method": "secant", "beta": beta, "beta_ci95": None, "beta_extreme_bound": [best, worst],
        "alpha": None, "alpha_ci95": None, "preferred": None, "verdict": "inconclusive",
        "beta_upper95": None, "decay_per_doubling": depth, "decay_basis": "secant_exponential_upper",
        "summary": (f"Secant over n={first['n_qubits']}..{last['n_qubits']} using the interval extremes "
                    f"(no confidence interval): {reason}."),
    }


def _unavailable(reason: str) -> dict[str, Any]:
    return {
        "fit_method": "unavailable", "beta": BETA_UNAVAILABLE, "beta_ci95": None, "beta_extreme_bound": None,
        "alpha": None, "alpha_ci95": None, "preferred": None, "verdict": "inconclusive",
        "beta_upper95": None, "decay_per_doubling": TRAIN_PENALTY_CAP, "decay_basis": "unavailable",
        "summary": f"No scaling fit: {reason}. Scored at the maximum trainability penalty.",
    }


def _decay_per_doubling(fit: dict[str, Any], n_max: int) -> tuple[float, str]:
    alpha_hi = max(float(fit["power_law"]["alpha_ci95"][1]), 0.0)
    beta_hi = max(float(fit["exponential"]["beta_ci95"][1]), 0.0)
    exp_depth = beta_hi * n_max / 2.0
    if fit["verdict"] != "inconclusive" and fit["preferred"] == "power_law":
        return alpha_hi, "alpha_upper95"
    if fit["verdict"] != "inconclusive" and fit["preferred"] == "exponential":
        return exp_depth, "beta_upper95*n_max/2"
    return max(alpha_hi, exp_depth), "max(alpha_upper95, beta_upper95*n_max/2)"


def fit_trainability(points: list[dict[str, Any]], seed: int) -> dict[str, Any]:
    """``beta`` (+ interval), ``alpha``, the verdict, ``decay_per_doubling`` and ``trainability_term``."""
    n_max = max(p["n_qubits"] for p in points)
    usable = sorted((p for p in points if is_informative_point(p)), key=lambda p: p["n_qubits"])
    distinct = {p["n_qubits"] for p in usable}
    wire = [{k: p[k] for k in ("n_qubits", "n_layers", "variance", "variance_ci95")} for p in usable]
    fits = fit_scaling(wire, seed=seed) if len(distinct) >= 2 else []
    top = fits[0] if fits else None
    if top and top["exponential"] and top["power_law"]:
        depth, basis = _decay_per_doubling(top, n_max)
        fit = {
            "fit_method": "weighted_log_fit", "beta": top["exponential"]["beta"],
            "beta_ci95": list(top["exponential"]["beta_ci95"]), "beta_extreme_bound": None,
            "alpha": top["power_law"]["alpha"], "alpha_ci95": list(top["power_law"]["alpha_ci95"]),
            "preferred": top["preferred"], "verdict": top["verdict"],
            "beta_upper95": float(top["exponential"]["beta_ci95"][1]),
            "decay_per_doubling": depth, "decay_basis": basis, "summary": top["summary"],
        }
    elif len(distinct) >= 2:
        reason = (top["summary"] if top else "too few informative sizes").rstrip(".").lower()
        fit = _secant(usable, n_max, reason)
    else:
        fit = _unavailable(f"{len(distinct)} informative size(s) of {len(points)} (stopped or wide-interval runs are excluded)")
    return {
        **fit, "n_layers": points[0]["n_layers"], "fits": fits, "informative_sizes": sorted(distinct),
        "trainability_term": -min(fit["decay_per_doubling"], TRAIN_PENALTY_CAP),
    }
