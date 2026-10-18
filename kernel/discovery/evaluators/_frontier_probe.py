"""PPE-backed measurements for ``trainability_frontier``: variance points, beta, hardness.

Everything here is a measurement with an explicit method label; none of it is a proof.

Trainability term
-----------------
``Var[dC/dtheta] ~ 2^(-beta n)`` is fitted by ``kernel.trainability.scaling.fit_scaling``
(weighted log-fit with a bootstrap CI over points). ``beta_upper95`` is the upper end of the
exponential model's 95% CI, **whether or not the exponential model is preferred**: a
polynomially decaying variance still has a (small) exponential envelope, and reporting its
upper bound is the pessimistic reading. The trainability term is ``-max(beta_upper95, 0)``,
so a variance that is flat or growing earns 0, never a bonus. When ``fit_scaling`` is
inconclusive (fewer than 4 distinct sizes, as on the ``screen`` stage, or a zero variance)
a *pessimistic secant* over the extreme sizes is used instead and labelled as such.

Estimation hardness
-------------------
At the largest size, for three seeded random parameter points, the PPE interval width of
``<O>`` is measured on a geometric grid of frontier sizes. ``frontier_needed`` is the
smallest size reaching ``target_width``; if none does, ``max_frontier`` is used and the point
is *censored* (the true need is at least that large). ``hardness = log10(frontier_needed)``;
fitness uses the minimum over the points. This is resistance to *this* estimator under *this*
budget, nothing more.
"""

from __future__ import annotations

import math
import time
from typing import Any, Callable

import numpy as np

from kernel.discovery.evaluators._frontier_config import MIN_FRONTIER
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.pauli import PauliSum
from kernel.trainability.pauliprop import ppe_frontier_curve, ppe_gradient_variances
from kernel.trainability.scaling import fit_scaling

PROBE_POINTS = 3
FRONTIER_BASE = 100
VARIANCE_FLOOR = 1e-300
EXACT_REL_WIDTH = 0.10
#: Independent random streams per stage so ``confirm`` never reuses ``full``'s points.
STAGE_STREAM = {"screen": 1, "full": 2, "confirm": 3}
#: Per-point probe cap, as a multiple of ``time_budget_s`` (each frontier size gets one budget).
PROBE_BUDGET_FACTOR = 2.0

Cancel = Callable[[], bool] | None


def variance_point(
    circuit: ParamCircuit, observable: PauliSum, *, max_frontier: int, time_budget_s: float,
    n_layers: int, cancel: Cancel = None,
) -> dict[str, Any]:
    """Exact (or rigorously bounded) mean gradient variance at one size, plus per-parameter rows."""
    result = ppe_gradient_variances(
        circuit, observable, min_weight_abs=0, max_frontier=max_frontier,
        time_budget_s=time_budget_s, cancel=cancel,
    )
    low, high = (float(x) for x in result["variance_mean_interval"])
    mean = float(result["variance_mean"])
    return {
        "n_qubits": circuit.n_qubits, "n_layers": n_layers, "variance": mean,
        "variance_ci95": [low, high], "method": result["method"], "status": result["status"],
        "relative_width": (high - low) / mean if mean > 0 else None,
        "frontier_peak": int(result["frontier_peak"]), "elapsed_ms": float(result["elapsed_ms"]),
        "per_parameter": result["per_parameter"],
    }


def is_exact_point(point: dict[str, Any]) -> bool:
    """Interval width <= 10% of the estimate (a zero estimate with zero width counts as exact)."""
    width = point["variance_ci95"][1] - point["variance_ci95"][0]
    if point["variance"] <= 0:
        return width == 0
    return width <= EXACT_REL_WIDTH * point["variance"]


def public_point(point: dict[str, Any]) -> dict[str, Any]:
    """The JSON-facing fields of a variance point (drops the per-parameter rows)."""
    return {k: v for k, v in point.items() if k != "per_parameter"} | {"exact": is_exact_point(point)}


def _secant(points: list[dict[str, Any]], reason: str) -> dict[str, Any]:
    """Pessimistic two-end secant: slope from the smallest-n upper bound to the largest-n lower bound."""
    ordered = sorted(points, key=lambda p: p["n_qubits"])
    first, last = ordered[0], ordered[-1]
    span = float(last["n_qubits"] - first["n_qubits"])
    log2 = lambda v: math.log2(max(v, VARIANCE_FLOOR))  # noqa: E731
    beta = (log2(first["variance"]) - log2(last["variance"])) / span
    low = (log2(first["variance_ci95"][0]) - log2(last["variance_ci95"][1])) / span
    high = (log2(first["variance_ci95"][1]) - log2(last["variance_ci95"][0])) / span
    return {
        "method": "secant", "beta": beta, "beta_ci95": [low, high], "preferred": None,
        "verdict": "inconclusive", "n_layers": first["n_layers"], "fits": [],
        "summary": f"Secant over n={first['n_qubits']}..{last['n_qubits']} (interval extremes): {reason}.",
    }


def fit_beta(points: list[dict[str, Any]], seed: int) -> dict[str, Any]:
    """beta, its 95% CI and ``beta_upper95`` / ``trainability_term`` (see the module docstring)."""
    wire = [{k: p[k] for k in ("n_qubits", "n_layers", "variance", "variance_ci95")} for p in points]
    fits = fit_scaling(wire, seed=seed)
    exponential = fits[0]["exponential"] if fits else None
    if exponential:
        fit = {
            "method": "weighted_log_fit", "beta": exponential["beta"], "beta_ci95": list(exponential["beta_ci95"]),
            "preferred": fits[0]["preferred"], "verdict": fits[0]["verdict"], "n_layers": fits[0]["n_layers"],
            "fits": fits, "summary": fits[0]["summary"],
        }
    else:
        reason = fits[0]["summary"] if fits else "no usable variance points"
        fit = _secant(points, reason.rstrip(".").lower())
        fit["fits"] = fits
    upper = float(fit["beta_ci95"][1])
    return {**fit, "beta_upper95": upper, "trainability_term": -max(upper, 0.0)}


def frontier_grid(max_frontier: int) -> list[int]:
    """Geometric grid 10^2, 10^3, ... below ``max_frontier``, always ending at ``max_frontier``."""
    grid: list[int] = []
    size = FRONTIER_BASE
    while size < max_frontier:
        grid.append(size)
        size *= 10
    return [*grid, max(int(max_frontier), MIN_FRONTIER)]


def probe_points(n_params: int, seed: int, stage: str, count: int = PROBE_POINTS) -> np.ndarray:
    """``count`` seeded parameter points ~ U[0, 2pi), shape ``(count, n_params)``."""
    rng = np.random.default_rng([abs(int(seed)), STAGE_STREAM.get(stage, 2)])
    return rng.uniform(0.0, 2.0 * math.pi, (count, n_params))


def hardness_of_point(
    circuit: ParamCircuit, observable: PauliSum, values: np.ndarray, *, target_width: float,
    max_frontier: int, time_budget_s: float, cancel: Cancel = None,
) -> dict[str, Any]:
    """Walk the frontier grid until the interval width reaches ``target_width`` (or the grid ends)."""
    deadline = time.monotonic() + PROBE_BUDGET_FACTOR * time_budget_s
    curve: list[dict[str, Any]] = []
    needed: int | None = None
    for size in frontier_grid(max_frontier):
        remaining = deadline - time.monotonic()
        if remaining <= 0 and curve:
            break
        step = ppe_frontier_curve(
            circuit, observable, values, frontier_sizes=[size],
            time_budget_s=max(min(time_budget_s, remaining), 0.05), cancel=cancel,
        )[0]
        curve.append({
            "max_frontier": int(step["max_frontier"]), "width": float(step["width"]),
            "value": float(step["value"]), "interval": [float(x) for x in step["interval"]],
            "method": step["method"], "elapsed_ms": float(step["elapsed_ms"]),
        })
        if step["width"] <= target_width:
            needed = int(size)
            break
    censored = needed is None
    frontier_needed = int(max_frontier) if censored else needed
    return {
        "curve": curve, "frontier_needed": frontier_needed, "censored": censored,
        "hardness": math.log10(frontier_needed),
    }


def hardness_probe(
    circuit: ParamCircuit, observable: PauliSum, *, seed: int, stage: str, target_width: float,
    max_frontier: int, time_budget_s: float, cancel: Cancel = None,
) -> dict[str, Any]:
    """The 3-point probe at the largest size; ``hardness_lower`` is the pessimistic minimum."""
    values = probe_points(len(circuit.parameters), seed, stage)
    points = [
        hardness_of_point(
            circuit, observable, row, target_width=target_width, max_frontier=max_frontier,
            time_budget_s=time_budget_s, cancel=cancel,
        ) | {"index": i}
        for i, row in enumerate(values)
    ]
    worst = min(points, key=lambda p: p["hardness"])
    return {
        "n_qubits": circuit.n_qubits, "points": points, "hardness_lower": float(worst["hardness"]),
        "frontier_needed_lower": int(worst["frontier_needed"]), "censored": bool(worst["censored"]),
        "target_width": target_width, "max_frontier": int(max_frontier),
    }
