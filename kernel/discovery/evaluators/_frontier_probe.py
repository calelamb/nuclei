"""PPE-backed variance points and probe-point sampling for ``trainability_frontier``.

Everything here is a measurement with an explicit method label; none of it is a proof.
The trainability fit lives in ``_frontier_trainability``, the exact-cost probe in ``_frontier_cost``.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from kernel.discovery.evaluators._frontier_config import MIN_FRONTIER
from kernel.trainability.ir import ParamCircuit
from kernel.trainability.pauli import PauliSum
from kernel.trainability.pauliprop import ppe_gradient_variances

PROBE_POINTS = 3
FRONTIER_BASE = 100
VARIANCE_FLOOR = 1e-300
EXACT_REL_WIDTH = 0.10
INFORMATIVE_RATIO = 2.0
#: Independent random streams per stage so ``confirm`` never reuses ``full``'s points.
STAGE_STREAM = {"screen": 1, "full": 2, "confirm": 3}

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
