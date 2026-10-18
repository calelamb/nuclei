"""Exact-simulation cost of ``<O>`` by Pauli propagation: the honest "hardness" of ``trainability_frontier``.

What is measured (adversarial review PH-H3)
-------------------------------------------
The old metric was the frontier at which the *unclipped* L1 bound reaches a target width. That
measures how loose the bound is, not how hard the problem is: the seed is exact with ~10^4 strings
and accurate to +-0.01 with a few hundred, yet scored 4.0 because its interval over discarded rows
stayed wide; a trivially simulable dense local brick got the censored maximum.

The primary quantity is now a concrete, reproducible statement: **Pauli propagation needed N
strings to compute <O> exactly** at the largest scored size. For each of ``PROBE_POINTS`` seeded
random parameter points an *untruncated* run (``min_weight_abs = 0``) is made within the budget
``max_frontier`` strings / ``time_budget_s`` seconds:

* the run completes: ``cost = log10(frontier_peak)``, uncensored;
* it does not (the frontier cap or the clock stopped it): ``cost`` is the lower bound
  ``log10(frontier_peak reached)`` and the point is *censored*. The aggregate is the minimum over the
  points (pessimistic) and is censored iff the minimising point is.

Intervals are clipped to ``+- sum_j |c_j|`` (``|<O>|`` cannot exceed it). The bound-width curve
(interval width versus frontier, one point) is a *secondary diagnostic* only and never enters the
score.

Honesty limits
--------------
High cost means *Pauli propagation* is expensive. It does not mean the circuit is classically hard:
tensor networks, light-cone simulation, stabilizer-plus-few-T methods and others may still be cheap.
Light-cone brute force is built into the scored value: a state vector on the observable's backward
light cone of width ``w`` costs ``2^w`` amplitudes, so the scored hardness is
``min(log10 strings, w log10 2)`` and a candidate with ``w <= 12`` (``<= 4096`` amplitudes) is capped
at 3.6 whatever Pauli propagation does. The raw PP cost is still reported as the objective.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from kernel.discovery.evaluators._frontier_observable import l1_norm
from kernel.discovery.evaluators._frontier_probe import frontier_grid, probe_points
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.pauli import PauliSum
from kernel.trainability.pauliprop import ppe_expectation_bounds, ppe_frontier_curve

LOG10_2 = math.log10(2.0)
EXACT_METHOD = "pauli_propagation_exact"

Cancel = Callable[[], bool] | None


def clip_interval(interval: list[float], bound: float) -> tuple[list[float], bool]:
    """``interval`` intersected with ``[-bound, bound]`` and whether that changed it."""
    low, high = max(float(interval[0]), -bound), min(float(interval[1]), bound)
    return [low, high], (low, high) != (float(interval[0]), float(interval[1]))


def exact_cost_point(
    circuit: ParamCircuit, observable: PauliSum, values: np.ndarray, *, max_frontier: int,
    time_budget_s: float, cancel: Cancel = None,
) -> dict[str, Any]:
    """One untruncated PPE run of ``<O>`` at ``values`` and its cost record."""
    res = ppe_expectation_bounds(
        circuit, observable, values, min_weight_abs=0, max_frontier=max_frontier,
        time_budget_s=time_budget_s, cancel=cancel,
    )
    bound = l1_norm(observable)
    interval, clipped = clip_interval(res["interval"], bound)
    peak = max(int(res["frontier_peak"]), 1)
    exact = res["method"] == EXACT_METHOD and res["status"] == "complete"
    return {
        "exact": exact, "censored": not exact, "status": res["status"], "frontier_peak": peak,
        "log10_strings": math.log10(peak), "value": min(max(float(res["value"]), -bound), bound),
        "interval": interval, "interval_clipped": clipped,
    }


def bound_width_curve(
    circuit: ParamCircuit, observable: PauliSum, values: np.ndarray, *, max_frontier: int,
    time_budget_s: float, target_width: float, cancel: Cancel = None,
) -> dict[str, Any]:
    """Secondary diagnostic: truncated-interval width versus frontier (clipped; never scored)."""
    bound = l1_norm(observable)
    steps, reached = [], None
    for size in frontier_grid(max_frontier)[:-1]:
        step = ppe_frontier_curve(
            circuit, observable, values, frontier_sizes=[size], time_budget_s=time_budget_s, cancel=cancel,
        )[0]
        interval, _ = clip_interval(step["interval"], bound)
        width = interval[1] - interval[0]
        steps.append({"max_frontier": int(size), "width": width, "interval": interval, "method": step["method"]})
        if width <= target_width:
            reached = int(size)
            break
    return {
        "role": "diagnostic_only", "l1_bound": bound, "target_width": target_width,
        "frontier_reaching_target_width": reached, "curve": steps,
        "note": "How loose the truncation bound is. It measures the bound, not the difficulty of the problem.",
    }


def pp_exact_cost(
    circuit: ParamCircuit, observable: PauliSum, *, seed: int, stage: str, max_frontier: int,
    time_budget_s: float, target_width: float, cancel: Cancel = None,
) -> dict[str, Any]:
    """The 3-point exact-cost probe at the largest size; ``log10_strings_lower`` is the minimum."""
    values = probe_points(len(circuit.parameters), seed, stage)
    points = [
        exact_cost_point(
            circuit, observable, row, max_frontier=max_frontier, time_budget_s=time_budget_s, cancel=cancel,
        ) | {"index": i}
        for i, row in enumerate(values)
    ]
    worst = min(points, key=lambda p: p["log10_strings"])
    diagnostics = bound_width_curve(
        circuit, observable, values[0], max_frontier=max_frontier, time_budget_s=time_budget_s,
        target_width=target_width, cancel=cancel,
    )
    return {
        "n_qubits": circuit.n_qubits, "points": points, "log10_strings_lower": float(worst["log10_strings"]),
        "strings_lower": int(worst["frontier_peak"]), "censored": bool(worst["censored"]),
        "max_frontier": int(max_frontier), "time_budget_s": time_budget_s,
        "statement": _statement(worst, circuit.n_qubits),
        "diagnostics": {"bound_width_curve": diagnostics},
    }


def _statement(point: dict[str, Any], n: int) -> str:
    if point["censored"]:
        return (f"Pauli propagation did not finish within the budget at n={n}: it needed at least "
                f"{point['frontier_peak']} strings to compute <O> exactly (censored lower bound).")
    return f"Pauli propagation needed {point['frontier_peak']} strings to compute <O> exactly at n={n}."


def scored_hardness(cost: dict[str, Any], light_cone_width: int) -> dict[str, Any]:
    """The value the fitness uses: PP cost capped by the light-cone brute-force cost ``w log10 2``."""
    cone_cost = light_cone_width * LOG10_2
    raw = cost["log10_strings_lower"]
    return {
        "value": min(raw, cone_cost), "pp_log10_strings": raw, "light_cone_log10_amplitudes": cone_cost,
        "capped_by_light_cone": cone_cost < raw,
    }
