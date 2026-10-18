"""Interval-aware evaluation of a conjecture's prediction on one tested circuit.

Every checked quantity is an *interval* ``[lo, hi]`` (a point quantity has
``lo == hi``; ``hi = None`` means unbounded above). With comparison ``op`` and
threshold ``c`` a circuit

* **meets** the prediction only if the *whole* interval satisfies it
  (``beta_upper95 < 0.1`` needs the upper end of beta's 95% interval below
  0.1);
* **violates** it only if *no* point of the interval satisfies it (a
  refutation must hold even under the most favorable reading of the data);
* is **indeterminate** otherwise: the interval straddles the threshold, the
  fit is undefined, or some point is bounded-not-exact (budget-truncated or a
  wide Pauli-propagation interval), so the evidence is too loose to decide.

Indeterminate circuits never support a conjecture and never refute one.
"""

from __future__ import annotations

import math
from typing import Any

MEETS, VIOLATES, INDETERMINATE = "meets", "violates", "indeterminate"
LOOSE_RELATIVE_WIDTH = 0.5


def interval_outcome(lo: float, hi: float | None, op: str, value: float) -> str:
    """Classify ``[lo, hi]`` against ``op value`` (see module docstring)."""
    top = math.inf if hi is None else hi
    if op == "<":
        return MEETS if top < value else VIOLATES if lo >= value else INDETERMINATE
    if op == "<=":
        return MEETS if top <= value else VIOLATES if lo > value else INDETERMINATE
    if op == ">":
        return MEETS if lo > value else VIOLATES if top <= value else INDETERMINATE
    if op == ">=":
        return MEETS if lo >= value else VIOLATES if top < value else INDETERMINATE
    raise ValueError(f"unsupported interval op {op!r}")


def point_is_loose(variance: float | None, interval: list[float] | None, status: str | None) -> bool:
    """True if a variance point is bounded-not-exact: truncated by a budget or relatively wide.

    A ``None`` variance (an unresolved PPE point) is always loose."""
    if variance is None or status not in (None, "complete"):
        return True
    if not interval:
        return False
    width = float(interval[1]) - float(interval[0])
    return width > LOOSE_RELATIVE_WIDTH * max(abs(variance), 1e-300)


def _verdict_outcome(actual: str, op: str, value: Any, observed: dict[str, Any]) -> tuple[str, str]:
    """``(outcome, reason)`` of a ``verdict`` prediction.

    The fit's verdict is only as strong as the evidence behind it (PH-M1): a ``polynomial`` reached through
    the beta-interval rule alone (``fit_verdict_basis == "beta_upper"``) has no model-selection support, and a
    ``barren_plateau`` whose beta interval, widened to the point-interval extremes, reaches 0.1 is not robust
    to the Pauli-propagation intervals; both are indeterminate rather than meets/violates.
    """
    wanted = value if isinstance(value, list) else [value]
    if actual == "inconclusive" and "inconclusive" not in wanted:
        return INDETERMINATE, observed.get("fit_summary") or "the fit is inconclusive"
    if actual == "polynomial" and observed.get("fit_verdict_basis") == "beta_upper":
        return INDETERMINATE, ("the 'polynomial' verdict rests on the beta interval alone (no model-selection "
                               "support), so it cannot decide a verdict prediction")
    hull = observed.get("beta_ci95")
    if actual == "barren_plateau" and hull is not None and hull[0] <= 0.1:
        return INDETERMINATE, (f"the 'barren_plateau' verdict is not robust to the point intervals "
                               f"(beta interval {hull[0]:.3g} to {hull[1]:.3g} reaches 0.1)")
    hit = actual in wanted
    return (MEETS if hit == (op != "!=") else VIOLATES), ""


def evaluate_prediction(prediction: dict[str, Any], observed: dict[str, Any]) -> tuple[str, list | str | None, str]:
    """Return ``(outcome, quantity_value, reason)`` for one circuit.

    ``observed`` carries ``beta_ci95``, ``fit_verdict``, ``fit_verdict_basis``, ``fit_summary``, ``max_n_interval``,
    ``log2_dla_interval`` (each ``None`` when unavailable), ``loose_points`` (qubit counts with
    non-exact points), ``max_n`` and ``errors`` (point failures).
    """
    quantity, op, value = prediction["quantity"], prediction["op"], prediction["value"]
    loose = observed.get("loose_points") or []
    if quantity == "log2_dla_dimension":
        interval = observed.get("log2_dla_interval")
        if interval is None:
            return INDETERMINATE, None, "the DLA dimension could not be determined"
        return interval_outcome(interval[0], interval[1], op, value), interval, ""
    if observed.get("errors"):
        first = observed["errors"][0]
        return INDETERMINATE, None, f"point n = {first['n_qubits']} failed: {first['message']}"
    if quantity == "variance_at_max_n":
        interval = observed.get("max_n_interval")
        if interval is None:
            return INDETERMINATE, None, "no variance at the largest n"
        if observed["max_n"] in loose:
            return INDETERMINATE, interval, f"the n = {observed['max_n']} point is bounded, not exact"
        return interval_outcome(interval[0], interval[1], op, value), interval, ""
    if loose:
        return INDETERMINATE, observed.get("beta_ci95"), f"points at n = {loose} are bounded, not exact"
    if quantity == "verdict":
        actual = observed.get("fit_verdict")
        if actual is None:
            return INDETERMINATE, None, "no fit verdict"
        outcome, why = _verdict_outcome(actual, op, value, observed)
        return outcome, actual, why
    beta = observed.get("beta_ci95")
    if beta is None:
        return INDETERMINATE, None, observed.get("fit_summary") or "the scaling fit is undefined"
    return interval_outcome(beta[0], beta[1], op, value), beta, ""
