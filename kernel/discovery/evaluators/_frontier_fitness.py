"""The fitness combination of ``trainability_frontier``, shared by the scorer and the independent audit."""

from __future__ import annotations

from typing import Any

from kernel.discovery.evaluators._frontier_probe import is_exact_point

#: Fitness subtracted per fraction of scored sizes whose variance is not an exact measurement.
INEXACT_PENALTY = 1.0


def inexact_sizes(points: list[dict[str, Any]]) -> list[int]:
    """Sizes whose variance point is stopped, missing (``None``), uninformative or wider than 10%."""
    return [p["n_qubits"] for p in points if not is_exact_point(p)]


def fitness_terms(
    weights: dict[str, float], trainability_term: float, hardness_value: float, points: list[dict[str, Any]],
) -> dict[str, float]:
    """``{"trainability", "hardness", "inexact_penalty"}``; fitness is their sum."""
    penalty = INEXACT_PENALTY * len(inexact_sizes(points)) / len(points)
    return {
        "trainability": weights["trainability"] * trainability_term,
        "hardness": weights["hardness"] * hardness_value,
        "inexact_penalty": -penalty,
    }
