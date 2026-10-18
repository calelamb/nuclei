"""PPE-backed measurements for ``trainability_frontier``: variance points and the hardness probe.

Everything here is a measurement with an explicit method label; none of it is a proof.
The trainability fit lives in ``_frontier_trainability``.
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

PROBE_POINTS = 3
FRONTIER_BASE = 100
VARIANCE_FLOOR = 1e-300
EXACT_REL_WIDTH = 0.10
INFORMATIVE_RATIO = 2.0
#: Independent random streams per stage so ``confirm`` never reuses ``full``'s points.
STAGE_STREAM = {"screen": 1, "full": 2, "confirm": 3}
#: Per-point probe cap, as a multiple of ``time_budget_s`` (each frontier size gets one budget).
PROBE_BUDGET_FACTOR = 2.0

Cancel = Callable[[], bool] | None


def variance_point(
    circuit: ParamCircuit, observable: PauliSum, *, max_frontier: int, time_budget_s: float,
    n_layers: int, cancel: Cancel = None,
) -> dict[str, Any]:
    """Exact (or rigorously bounded) mean gradient variance at one size, plus per-parameter rows.

    ``variance`` is ``None`` whenever the PPE reports no value (a timeout or an uninformative
    interval): such a point is never a variance, only an interval (see ``is_exact_point``).
    """
    result = ppe_gradient_variances(
        circuit, observable, min_weight_abs=0, max_frontier=max_frontier,
        time_budget_s=time_budget_s, cancel=cancel,
    )
    low, high = (float(x) for x in result["variance_mean_interval"])
    raw = result.get("variance_mean")
    mean = float(raw) if raw is not None else None
    status = result["status"]
    if status != "complete":  # a stopped run's midpoint is not a measurement (adversarial review PH-C1)
        mean = None
    return {
        "n_qubits": circuit.n_qubits, "n_layers": n_layers, "variance": mean,
        "variance_ci95": [low, high], "method": result["method"], "status": status,
        "relative_width": (high - low) / mean if mean else None,
        "frontier_peak": int(result["frontier_peak"]), "per_parameter": result["per_parameter"],
    }


def is_exact_point(point: dict[str, Any]) -> bool:
    """A value exists, the run completed, and the interval is within 10% of it (zero-width zero is exact)."""
    variance = point["variance"]
    if variance is None or point["status"] != "complete":
        return False
    width = point["variance_ci95"][1] - point["variance_ci95"][0]
    if variance <= 0:
        return width == 0
    return width <= EXACT_REL_WIDTH * variance


def is_informative_point(point: dict[str, Any]) -> bool:
    """Usable in a log-fit: a value, a positive lower bound and ``hi / lo <= INFORMATIVE_RATIO``."""
    low, high = point["variance_ci95"]
    return point["variance"] is not None and low > 0 and high / low <= INFORMATIVE_RATIO


def public_point(point: dict[str, Any]) -> dict[str, Any]:
    """The JSON-facing fields of a variance point (drops the per-parameter rows).

    Wall-clock timings are deliberately absent from every metric so a re-run is bit-identical.
    """
    return {k: v for k, v in point.items() if k != "per_parameter"} | {
        "exact": is_exact_point(point), "informative": is_informative_point(point),
    }


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
            "method": step["method"],
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
