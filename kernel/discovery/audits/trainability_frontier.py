"""Independent audit of a ``trainability_frontier`` evaluation (Red Queen mode, addendum F).

The audit re-derives the evaluator's claims from the raw sandbox artifacts with *different*
code paths and random streams, then compares. It never reads the evaluator's PPE code path
for its own numbers (it imports :mod:`kernel.trainability.pauliprop` directly) and it
re-parses every IR from JSON.

Checks (``fail`` means a disagreement beyond the stated intervals):

* ``reparse``: fresh ``ParamCircuit.from_json`` of each artifact, widths, ``ppe_applicable``.
* ``ppe_vs_sampling``: at the smallest size (<= 12 qubits) the recorded exact PPE variance
  must overlap the 99% CI of compiled statevector sampling (``gradient_statistics``,
  >= 512 samples). The 99% CI is the sampler's bootstrap 95% CI widened by
  z99/z95 about its centre, which assumes an approximately symmetric interval. One miss is
  retried with 4x samples and a new seed; only two misses fail (a 99% CI misses ~1 in 100).
* ``ppe_reproducible``: a fresh PPE run at every size must overlap the recorded point.
* ``dla_recheck``: fresh Lie closure at the probe size (larger dimension/time cap) must agree
  with the recorded dimension and still satisfy the evaluator's algebra rule.
* ``hardness_recheck``: the probe repeated on *fresh* random points; the pessimistic
  hardness may differ from the record by at most one decade (the grid step) before a warn,
  two before a fail.
* ``interval_consistency``: PPE intervals are nested, so the value at the largest frontier
  must lie inside every smaller-frontier interval of the same point.
* ``fitness_gap``: the audit's own fitness versus the evaluator's.

``audit_fitness`` is the fitness recomputed from the audit's own numbers (fresh variances,
fresh bootstrap seed, fresh hardness points) under the same weights. A hardness figure is
resistance to *this* estimator under *this* budget; the audit confirms the measurement, not
classical hardness.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from kernel.discovery.evaluators._frontier_config import effective_sizes, frontier_cap
from kernel.discovery.evaluators._frontier_metrics import algebra_verdict, dla_probe
from kernel.discovery.evaluators.trainability_frontier import INEXACT_PENALTY
from kernel.discovery.evaluators._frontier_probe import (
    EXACT_REL_WIDTH,
    PROBE_POINTS,
    VARIANCE_FLOOR,
    fit_beta,
    frontier_grid,
)
from kernel.trainability.analyses import gradient_statistics
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.lie import lie_algebra
from kernel.trainability.pauli import parse_observable
from kernel.trainability.pauliprop import ppe_applicable, ppe_frontier_curve, ppe_gradient_variances

SAMPLING_MAX_QUBITS = 12
SAMPLING_SAMPLES = 1024
SAMPLING_RETRY_SAMPLES = 4096
Z99_OVER_Z95 = 2.5758 / 1.96
AUDIT_STREAM = 97
AUDIT_SEED_OFFSET = 1009
DLA_AUDIT_MAX_DIMENSION = 8192
DLA_AUDIT_TIME_S = 30.0
NEST_TOL = 1e-9


def _check(check_id: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"id": check_id, "label": label, "status": status, "detail": detail}


def _cancel_fn(cancel: Any) -> Callable[[], bool] | None:
    if cancel is None:
        return None
    return cancel.is_set if hasattr(cancel, "is_set") else cancel


def _overlap(a: list[float], b: list[float], slack: float = 0.0) -> bool:
    return a[0] - slack <= b[1] and b[0] - slack <= a[1]


def _parse(artifacts: list[dict[str, Any]], count: int) -> list[ParamCircuit]:
    by_index = {a.get("call_index"): a.get("artifact") for a in artifacts}
    circuits = []
    for index in range(count):
        artifact = by_index.get(index)
        if not isinstance(artifact, dict):
            raise IrError("missing_artifact", f"no artifact for call {index}")
        circuits.append(ParamCircuit.from_json(artifact.get("ir")))
    return circuits


def _settings(config: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, Any]:
    recorded = (evaluation.get("metrics") or {}).get("settings") or {}
    stage = recorded.get("stage") or evaluation.get("stage") or "full"
    est = config["estimation"]
    return {
        "stage": stage,
        "sizes": recorded.get("sizes") or effective_sizes(config),
        "n_layers": recorded.get("n_layers", config["n_layers"]),
        "observable": recorded.get("observable", config["observable"]),
        "max_frontier": recorded.get("max_frontier", frontier_cap(config, stage)),
        "time_budget_s": recorded.get("time_budget_s", est["time_budget_s"]),
        "target_width": recorded.get("target_width", est["target_width"]),
        "weights": recorded.get("weights", config["weights"]),
    }


def _reparse_check(circuits: list[ParamCircuit], st: dict[str, Any]) -> dict[str, str]:
    expected = [*st["sizes"]]
    for circuit, n in zip(circuits, expected):
        if circuit.n_qubits != n:
            return _check("reparse", "Artifacts re-parse with the expected widths", "fail",
                          f"build({n}, ...) has {circuit.n_qubits} qubits on re-parse.")
        ok, reason = ppe_applicable(circuit, parse_observable(st["observable"], n), init="uniform")
        if not ok:
            return _check("reparse", "Artifacts re-parse with the expected widths", "fail",
                          f"n={n}: PPE no longer applies on re-parse: {reason}")
    return _check("reparse", "Artifacts re-parse with the expected widths", "pass",
                  f"{len(circuits)} artifacts re-parsed; PPE applies at every size.")


def _fresh_points(circuits: list[ParamCircuit], st: dict[str, Any], cancel, progress) -> list[dict[str, Any]]:
    points = []
    for index, (circuit, n) in enumerate(zip(circuits, st["sizes"])):
        result = ppe_gradient_variances(
            circuit, parse_observable(st["observable"], n), min_weight_abs=0,
            max_frontier=st["max_frontier"], time_budget_s=st["time_budget_s"], cancel=cancel,
        )
        points.append({
            "n_qubits": n, "n_layers": st["n_layers"], "variance": float(result["variance_mean"]),
            "variance_ci95": [float(x) for x in result["variance_mean_interval"]],
        })
        if progress:
            progress(0.1 + 0.3 * (index + 1) / len(st["sizes"]), "re-running PPE variances")
    return points


def _recorded_points(evaluation: dict[str, Any]) -> list[dict[str, Any]]:
    return list((evaluation.get("metrics") or {}).get("variance_points") or [])


def _reproducible_check(fresh: list[dict[str, Any]], recorded: list[dict[str, Any]]) -> dict[str, str]:
    label = "Fresh PPE variances match the record"
    if len(recorded) != len(fresh):
        return _check("ppe_reproducible", label, "fail",
                      f"{len(recorded)} recorded variance points but {len(fresh)} sizes were scored.")
    for new, old in zip(fresh, recorded):
        slack = 1e-12 * max(abs(new["variance"]), abs(old["variance"]), 1e-300)
        if new["n_qubits"] != old["n_qubits"] or not _overlap(new["variance_ci95"], old["variance_ci95"], slack):
            return _check("ppe_reproducible", label, "fail", (
                f"n={new['n_qubits']}: fresh PPE variance {new['variance']:.4e} {new['variance_ci95']} "
                f"disagrees with the recorded {old['variance']:.4e} {old['variance_ci95']}."))
    return _check("ppe_reproducible", label, "pass", "Every fresh variance interval overlaps the recorded one.")


def _sample_ci99(circuit: ParamCircuit, st: dict[str, Any], samples: int, seed: int, cancel) -> tuple[float, list[float]]:
    stats = gradient_statistics(
        circuit, parse_observable(st["observable"], circuit.n_qubits), samples=samples,
        seed=seed, init="uniform", method="sampling", cancel=cancel,
    )
    centre = float(stats["variance_mean"])
    low, high = (float(x) for x in stats["variance_mean_ci95"])
    return centre, [centre - (centre - low) * Z99_OVER_Z95, centre + (high - centre) * Z99_OVER_Z95]


def _sampling_check(
    circuit: ParamCircuit, recorded: list[dict[str, Any]], st: dict[str, Any], seed: int, cancel,
) -> dict[str, str]:
    """PPE vs sampling. A miss of the 99% CI is retried once with 4x samples and a new seed.

    A 99% interval misses an exact value about 1 time in 100 (and the bootstrap CI is a little
    optimistic), so a single miss is not evidence; two independent misses are.
    """
    label = "PPE variance lies in the sampling 99% CI"
    n = circuit.n_qubits
    if n > SAMPLING_MAX_QUBITS or not recorded:
        return _check("ppe_vs_sampling", label, "skipped",
                      f"Smallest size n={n} exceeds {SAMPLING_MAX_QUBITS} qubits; statevector sampling is not run.")
    claimed = recorded[0]
    attempts = []
    for attempt, samples in enumerate((SAMPLING_SAMPLES, SAMPLING_RETRY_SAMPLES)):
        centre, ci99 = _sample_ci99(circuit, st, samples, seed + AUDIT_SEED_OFFSET + attempt, cancel)
        attempts.append(f"sampling {centre:.4e}, 99% CI [{ci99[0]:.4e}, {ci99[1]:.4e}] ({samples} samples)")
        if _overlap(claimed["variance_ci95"], ci99):
            return _check("ppe_vs_sampling", label, "pass", f"n={n}: PPE {claimed['variance']:.4e} vs " + attempts[-1] + ".")
    return _check("ppe_vs_sampling", label, "fail", (
        f"n={n}: the recorded PPE variance {claimed['variance']:.4e} is outside the sampling 99% CI twice: "
        + "; ".join(attempts) + "."))


def _dla_check(probe_circuit: ParamCircuit, evaluation: dict[str, Any], cancel) -> dict[str, str]:
    label = "Fresh Lie closure agrees with the recorded DLA"
    fresh = dla_probe(probe_circuit, cancel)
    fresh_full = lie_algebra(
        probe_circuit, observable=None, max_dimension=DLA_AUDIT_MAX_DIMENSION,
        time_budget_s=DLA_AUDIT_TIME_S, cancel=cancel,
    )
    recorded = (evaluation.get("metrics") or {}).get("dla") or {}
    bound = fresh_full["dimension_lower_bound"]
    old_dim, old_bound = recorded.get("dimension"), recorded.get("dimension_lower_bound")
    if fresh_full["dimension"] is not None and old_dim is not None and fresh_full["dimension"] != old_dim:
        return _check("dla_recheck", label, "fail",
                      f"Fresh DLA dimension {fresh_full['dimension']} differs from the recorded {old_dim}.")
    if old_bound is not None and fresh_full["dimension"] is not None and fresh_full["dimension"] < old_bound:
        return _check("dla_recheck", label, "fail",
                      f"Recorded lower bound {old_bound} exceeds the fresh complete dimension {fresh_full['dimension']}.")
    ok, detail = algebra_verdict(probe_circuit, fresh)
    if not ok:
        return _check("dla_recheck", label, "fail", f"The evaluator accepted a trivial algebra: {detail}")
    return _check("dla_recheck", label, "pass", f"Fresh closure reaches {bound}; {detail}")


def _fresh_hardness(circuit: ParamCircuit, st: dict[str, Any], seed: int, cancel) -> dict[str, Any]:
    obs = parse_observable(st["observable"], circuit.n_qubits)
    rng = np.random.default_rng([abs(int(seed)), AUDIT_STREAM])
    budget = st["time_budget_s"]
    values = rng.uniform(0.0, 2.0 * math.pi, (PROBE_POINTS, len(circuit.parameters)))
    results, nested_bad = [], None
    for index, row in enumerate(values):
        curve, needed = [], None
        for size in frontier_grid(st["max_frontier"]):
            step = ppe_frontier_curve(circuit, obs, row, frontier_sizes=[size], time_budget_s=budget, cancel=cancel)[0]
            curve.append(step)
            if step["width"] <= st["target_width"]:
                needed = int(size)
                break
        if index == 0 and nested_bad is None:
            top = ppe_frontier_curve(
                circuit, obs, row, frontier_sizes=[st["max_frontier"]], time_budget_s=budget, cancel=cancel)[0]
            for step in curve:
                lo, hi = step["interval"]
                if not (lo - NEST_TOL <= top["value"] <= hi + NEST_TOL):
                    nested_bad = (step["max_frontier"], top["value"], lo, hi)
        frontier = needed if needed is not None else int(st["max_frontier"])
        results.append({"hardness": math.log10(frontier), "censored": needed is None})
    worst = min(results, key=lambda r: r["hardness"])
    return {"hardness_lower": worst["hardness"], "censored": worst["censored"], "nested_bad": nested_bad}


def _hardness_check(fresh: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, str]:
    label = "Hardness repeats on fresh random points"
    recorded = ((evaluation.get("metrics") or {}).get("hardness") or {}).get("hardness_lower")
    if recorded is None:
        return _check("hardness_recheck", label, "fail", "The evaluation records no hardness to audit.")
    gap = abs(fresh["hardness_lower"] - recorded)
    detail = f"recorded {recorded:.2f}, fresh points {fresh['hardness_lower']:.2f} (log10 frontier); gap {gap:.2f} decades."
    if gap <= 1.0 + 1e-9:
        return _check("hardness_recheck", label, "pass", detail)
    return _check("hardness_recheck", label, "warn" if gap <= 2.0 + 1e-9 else "fail", detail)


def _nested_check(fresh: dict[str, Any]) -> dict[str, str]:
    label = "PPE intervals are nested across frontier sizes"
    bad = fresh["nested_bad"]
    if bad is None:
        return _check("interval_consistency", label, "pass", "The top-frontier value lies in every smaller interval.")
    size, value, lo, hi = bad
    return _check("interval_consistency", label, "fail",
                  f"Value {value:.6g} at the top frontier is outside the frontier-{size} interval [{lo:.6g}, {hi:.6g}].")


def _audit_fitness(
    points: list[dict[str, Any]], hardness: dict[str, Any], st: dict[str, Any], seed: int
) -> float:
    fit = fit_beta(points, seed + AUDIT_SEED_OFFSET)
    loose = sum(
        1 for p in points
        if (p["variance_ci95"][1] - p["variance_ci95"][0]) > EXACT_REL_WIDTH * max(p["variance"], VARIANCE_FLOOR)
    )
    weights = st["weights"]
    return float(
        weights["trainability"] * fit["trainability_term"] + weights["hardness"] * hardness["hardness_lower"]
        - INEXACT_PENALTY * loose / len(points)
    )


def _gap_check(audit_fitness: float, evaluation: dict[str, Any], st: dict[str, Any]) -> dict[str, str]:
    label = "Audit fitness agrees with the evaluator's"
    claimed = evaluation.get("fitness")
    if claimed is None:
        return _check("fitness_gap", label, "skipped", "The evaluation has no fitness.")
    tolerance = st["weights"]["hardness"] * 1.0 + 0.1
    gap = float(claimed) - audit_fitness
    detail = f"evaluator {claimed:.4f}, audit {audit_fitness:.4f}, gap {gap:+.4f} (tolerance {tolerance:.2f})."
    if abs(gap) <= tolerance:
        return _check("fitness_gap", label, "pass", detail)
    return _check("fitness_gap", label, "warn" if abs(gap) <= 2 * tolerance else "fail", detail)


def audit(
    config: dict[str, Any],
    artifacts: list[dict[str, Any]],
    seed: int,
    *,
    evaluation: dict[str, Any],
    progress: Callable[[float, str], None] | None = None,
    cancel: Any = None,
    cache_dir: str | None = None,
) -> dict[str, Any]:
    """Re-check a scored ``trainability_frontier`` evaluation (see the module docstring)."""
    if evaluation.get("status") != "scored":
        skipped = _check("evaluation_scored", "Evaluation is scored", "skipped",
                         f"Nothing to audit: the evaluation status is {evaluation.get('status')!r}.")
        return {"checks": [skipped], "audit_fitness": None, "notes": []}
    st = _settings(config, evaluation)
    cancel_fn = _cancel_fn(cancel)
    try:
        circuits = _parse(artifacts, len(st["sizes"]) + 1)
    except IrError as exc:
        failed = _check("reparse", "Artifacts re-parse with the expected widths", "fail", f"{exc.code}: {exc.message}")
        return {"checks": [failed], "audit_fitness": None, "notes": []}
    sized, probe = circuits[:-1], circuits[-1]
    checks = [_reparse_check(sized, st)]
    if checks[0]["status"] == "fail":
        return {"checks": checks, "audit_fitness": None, "notes": []}
    recorded = _recorded_points(evaluation)
    fresh = _fresh_points(sized, st, cancel_fn, progress)
    checks.append(_reproducible_check(fresh, recorded))
    checks.append(_sampling_check(sized[0], recorded, st, seed, cancel_fn))
    if progress:
        progress(0.5, "re-checking the dynamical Lie algebra")
    checks.append(_dla_check(probe, evaluation, cancel_fn))
    if progress:
        progress(0.7, "re-running the hardness probe on fresh points")
    hardness = _fresh_hardness(sized[-1], st, seed, cancel_fn)
    checks.extend([_hardness_check(hardness, evaluation), _nested_check(hardness)])
    audit_fitness = _audit_fitness(fresh, hardness, st, seed)
    checks.append(_gap_check(audit_fitness, evaluation, st))
    notes = [
        "Hardness is resistance to this Pauli-propagation estimator under this budget; the audit "
        "re-measures it on fresh points and does not establish classical hardness.",
    ]
    return {"checks": checks, "audit_fitness": audit_fitness, "notes": notes}
