"""Conjecture schema, validation and the discovery-protocol schema message payload."""

from __future__ import annotations

import math
from typing import Any

from kernel.discovery.conjecture import predicate as pred
from kernel.discovery.conjecture.errors import SpecError
from kernel.discovery.conjecture.grammar import family_schema, validate_family

MIN_CIRCUITS, MAX_CIRCUITS = 5, 32
MIN_POINTS, MAX_POINTS = 4, 8
MAX_N = 128
MIN_N = 2
DEFAULT_DLA_PROBE = 4
MAX_DLA_PROBE = 8
DEFAULT_PER_CIRCUIT_S = 60.0
DEFAULT_TOTAL_S = 600.0
MAX_BUDGET_S = 1200.0
VERDICTS = ("barren_plateau", "polynomial", "inconclusive")
_NUMERIC_OPS = ("<", "<=", ">", ">=")

#: name -> (allowed ops, value type, description)
QUANTITIES: dict[str, tuple[tuple[str, ...], str, str]] = {
    "beta_upper95": (_NUMERIC_OPS, "number",
                     "The 95% interval of the exponential decay rate beta in Var ~ 2^(-beta n), fitted over the "
                     "tested qubit counts (a parametric bootstrap from the per-point intervals, widened to the "
                     "interval extremes for Pauli-propagation points; an estimate from 4 to 8 points, not a proof). "
                     "A circuit meets 'beta_upper95 < c' only if the whole interval lies below c."),
    "verdict": (("==", "!=", "in"), "string",
                "The scaling-fit verdict: barren_plateau, polynomial or inconclusive. A 'polynomial' reached only "
                "through the beta-interval rule is judged indeterminate for this quantity."),
    "variance_at_max_n": (_NUMERIC_OPS, "number",
                          "Mean gradient variance (with its Pauli-propagation truncation or bootstrap interval) at the largest tested qubit count."),
    "log2_dla_dimension": (_NUMERIC_OPS, "number",
                           "log2 of the dynamical Lie algebra dimension at the small probe qubit count."),
}


def _number(value: Any, path: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not lo <= value <= hi:
        raise SpecError(path, f"must be a number between {lo:g} and {hi:g}")
    return float(value)


def _integer(value: Any, path: str, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise SpecError(path, f"must be an integer between {lo} and {hi}")
    return value


def _prediction(raw: Any) -> dict[str, Any]:
    path = "prediction"
    if not isinstance(raw, dict) or set(raw) != {"quantity", "op", "value"}:
        raise SpecError(path, "must be an object with exactly quantity, op and value")
    quantity = raw["quantity"]
    if quantity not in QUANTITIES:
        raise SpecError(f"{path}.quantity", f"must be one of {', '.join(QUANTITIES)}")
    ops, vtype, _ = QUANTITIES[quantity]
    if raw["op"] not in ops:
        raise SpecError(f"{path}.op", f"'{quantity}' supports only {', '.join(ops)}")
    value = raw["value"]
    if vtype == "number":
        value = _number(value, f"{path}.value", -1e6, 1e6)
    else:
        items = value if raw["op"] == "in" else [value]
        if raw["op"] == "in" and (not isinstance(value, list) or not value):
            raise SpecError(f"{path}.value", "'in' needs a non-empty list")
        if any(v not in VERDICTS for v in items):
            raise SpecError(f"{path}.value", f"verdict values are {', '.join(VERDICTS)}")
    return {"quantity": quantity, "op": raw["op"], "value": value}


def validate_conjecture(raw: Any) -> dict[str, Any]:
    """Return a normalized conjecture (defaults filled) or raise :class:`SpecError` with a path."""
    if not isinstance(raw, dict):
        raise SpecError("conjecture", "must be an object")
    allowed = {"id", "statement", "feature_predicate", "prediction", "test_family", "n_range", "circuits",
               "points", "dla_probe_qubits", "budget"}
    unknown = set(raw) - allowed
    if unknown:
        raise SpecError("conjecture", f"unknown keys {sorted(map(str, unknown))}")
    for key in ("id", "statement"):
        text = raw.get(key)
        if not isinstance(text, str) or not text.strip() or len(text) > (80 if key == "id" else 800):
            raise SpecError(key, "must be a non-empty string" + (" (max 80 chars)" if key == "id" else " (max 800 chars)"))
    pred.validate(raw.get("feature_predicate"))
    prediction = _prediction(raw.get("prediction"))
    family = validate_family(raw.get("test_family"))
    rng = raw.get("n_range")
    if not isinstance(rng, list) or len(rng) != 2:
        raise SpecError("n_range", "must be [n_min, n_max]")
    n_min = _integer(rng[0], "n_range[0]", MIN_N, MAX_N)
    n_max = _integer(rng[1], "n_range[1]", MIN_N, MAX_N)
    if n_max - n_min < MIN_POINTS - 1:
        raise SpecError("n_range", f"must span at least {MIN_POINTS} distinct qubit counts")
    budget = raw.get("budget") or {}
    if not isinstance(budget, dict) or set(budget) - {"per_circuit_s", "total_s"}:
        raise SpecError("budget", "must be an object with optional per_circuit_s and total_s")
    return {
        "id": raw["id"].strip(), "statement": raw["statement"].strip(),
        "feature_predicate": raw.get("feature_predicate"), "prediction": prediction, "test_family": family,
        "n_range": [n_min, n_max],
        "circuits": _integer(raw.get("circuits"), "circuits", MIN_CIRCUITS, MAX_CIRCUITS),
        "points": _integer(raw.get("points", 5), "points", MIN_POINTS, MAX_POINTS),
        "dla_probe_qubits": _integer(raw.get("dla_probe_qubits", DEFAULT_DLA_PROBE), "dla_probe_qubits", 3,
                                     MAX_DLA_PROBE),
        "budget": {
            "per_circuit_s": _number(budget.get("per_circuit_s", DEFAULT_PER_CIRCUIT_S),
                                     "budget.per_circuit_s", 0.0, MAX_BUDGET_S),
            "total_s": _number(budget.get("total_s", DEFAULT_TOTAL_S), "budget.total_s", 0.0, MAX_BUDGET_S),
        },
    }


def qubit_counts(n_range: list[int], points: int) -> list[int]:
    """``points`` qubit counts geometrically spaced over ``n_range`` (deduplicated, ascending)."""
    lo, hi = n_range
    span = hi - lo + 1
    target = min(points, span)
    ns = sorted({int(round(lo * (hi / lo) ** (i / (target - 1)))) for i in range(target)})
    fill = lo
    while len(ns) < target:  # rounding merged some points: add the nearest unused counts
        if fill not in ns:
            ns.append(fill)
        fill += 1
    return sorted(ns)


def prediction_text(prediction: dict[str, Any]) -> str:
    value = prediction["value"]
    shown = f"{value:g}" if isinstance(value, float) else str(value)
    return f"{prediction['quantity']} {prediction['op']} {shown}"


def schema_payload() -> dict[str, Any]:
    """Body of ``discovery_conjecture_schema_result`` (features, quantities, family and predicate schemas)."""
    return {
        "features": [{"key": k, "type": t, "description": d, **({"values": list(v)} if v else {})}
                     for k, (t, d, v) in pred.FEATURES.items()],
        "quantities": [{"name": name, "ops": list(ops), "value_type": vtype, "description": desc}
                       for name, (ops, vtype, desc) in QUANTITIES.items()],
        "families": family_schema(),
        "predicate": pred.predicate_schema(),
        "limits": {"circuits": [MIN_CIRCUITS, MAX_CIRCUITS], "points": [MIN_POINTS, MAX_POINTS],
                   "n_max": MAX_N, "per_circuit_s": DEFAULT_PER_CIRCUIT_S, "total_s": DEFAULT_TOTAL_S},
    }
