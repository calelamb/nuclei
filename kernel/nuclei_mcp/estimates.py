"""Statistics: sinter's own helpers, wrapped with explicit provenance.

Estimators
----------
* point estimate and interval: ``sinter.fit_binomial`` on
  ``shots - discards`` trials and ``errors`` hits, with the caller-visible
  ``max_likelihood_factor`` (a likelihood-ratio region, NOT a Wald interval and
  not a named confidence level; the factor is recorded in every manifest).
* per-round rate: ``sinter.shot_error_rate_to_piece_error_rate`` applied to the
  best/low/high values (monotone, so the interval maps through).
* Lambda: ordinary least squares of ln(per-round rate) vs distance; the 95%
  interval is a Student-t interval on the slope. Needs >= 3 distinct distances.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

import sinter
from scipy import stats as scipy_stats

from .errors import ToolInputError

DEFAULT_LIKELIHOOD_FACTOR = 1000.0
MIN_DISTANCES_FOR_LAMBDA = 3
LAMBDA_CONFIDENCE = 0.95

CI_METHOD = "sinter.fit_binomial likelihood-ratio interval (max_likelihood_factor={factor:g})"
ESTIMATOR = "errors / (shots - discards), discard-aware"


def ci_method_label(factor: float) -> str:
    return CI_METHOD.format(factor=factor)


def interval(best: float, low: float, high: float) -> dict[str, float]:
    return {"best": best, "low": low, "high": high}


def point_estimate(
    *, shots: int, errors: int, discards: int, factor: float, rounds: float | None = None
) -> dict[str, Any]:
    """Rates for one aggregated point; ``per_round`` only when rounds is known."""
    kept = shots - discards
    if shots < 0 or errors < 0 or discards < 0 or kept < 0:
        raise ToolInputError(f"invalid counts shots={shots} errors={errors} discards={discards}")
    if errors > kept:
        raise ToolInputError(f"errors ({errors}) exceed kept shots ({kept}); counts are inconsistent")
    base = {"shots": shots, "errors": errors, "discards": discards, "kept_shots": kept}
    if kept == 0:
        return {**base, "per_shot": None, "per_round": None, "note": "all shots were discarded; no rate"}
    fit = sinter.fit_binomial(num_shots=kept, num_hits=errors, max_likelihood_factor=factor)
    per_shot = interval(fit.best, fit.low, fit.high)
    per_round = None
    if rounds is not None:
        per_round = {
            key: sinter.shot_error_rate_to_piece_error_rate(value, pieces=rounds)
            for key, value in per_shot.items()
        }
    return {**base, "per_shot": per_shot, "per_round": per_round}


def intervals_overlap(a: Mapping[str, float], b: Mapping[str, float]) -> bool:
    return a["low"] <= b["high"] and b["low"] <= a["high"]


def _not_estimated(reason: str) -> dict[str, Any]:
    return {"status": "not_estimated", "reason": reason}


def _lambda_from_slope(slope: float) -> float:
    """eps ~ Lambda^(-d/2)  =>  Lambda = exp(-2 * slope); raises OverflowError."""
    value = math.exp(-2.0 * slope)
    if not math.isfinite(value):
        raise OverflowError
    return value


def estimate_lambda(points: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Lambda from points ``{x, per_round: {best}, errors}``; honest refusals."""
    usable = []
    excluded = []
    for point in points:
        x = point["x"]
        rate = (point.get("per_round") or {}).get("best")
        if isinstance(x, bool) or not isinstance(x, int) or x < 2:
            return _not_estimated(f"x value {x!r} is not an integer code distance >= 2; Lambda needs code distances")
        if rate is None or point["errors"] == 0:
            excluded.append({"x": x, "reason": "no kept shots" if rate is None else "zero logical errors observed (ln rate undefined)"})
        else:
            usable.append((float(x), math.log(rate)))
    distances = sorted({x for x, _ in usable})
    if len(distances) < MIN_DISTANCES_FOR_LAMBDA:
        return {
            **_not_estimated(
                f"need >= {MIN_DISTANCES_FOR_LAMBDA} distinct distances with observed errors, got {len(distances)}"
            ),
            "excluded_points": excluded,
        }
    xs, ys = zip(*usable)
    reg = scipy_stats.linregress(xs, ys)
    slope, stderr = float(reg.slope), float(reg.stderr)
    tcrit = float(scipy_stats.t.ppf(0.5 + LAMBDA_CONFIDENCE / 2, len(xs) - 2))
    try:
        lam = _lambda_from_slope(slope)
        ci = {"low": _lambda_from_slope(slope + tcrit * stderr), "high": _lambda_from_slope(slope - tcrit * stderr)}
    except OverflowError:
        return {**_not_estimated("fitted slope is outside the representable range for Lambda; the data do not follow an exponential in distance"),
                "excluded_points": excluded}
    warnings = []
    if excluded:
        warnings.append(
            "Points were excluded; if they are the largest distances (where errors are rarest) the fit "
            "describes a different, higher-error regime than the full distance range."
        )
    return {
        "status": "estimated",
        "lambda": lam,
        "ci95": ci,
        "method": "OLS of ln(per-round rate) vs distance; Student-t interval on slope; unweighted",
        "n_points": len(xs),
        "degrees_of_freedom": len(xs) - 2,
        "r_squared": float(reg.rvalue) ** 2,
        "distances": distances,
        "excluded_points": excluded,
        "warnings": warnings,
    }
