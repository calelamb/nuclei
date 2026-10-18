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
* ``structure_recheck``: the stripped circuits at every scored and probe size are re-tested for
  tensor-product structure and cross-size consistency (the evaluator's PH-H2 guards).
* ``dla_recheck``: fresh Lie closure at *every* probe size (larger dimension/time cap) must
  agree with the recorded dimension and still satisfy the evaluator's algebra rule (> 4n^2).
* ``hardness_recheck``: the exact-cost probe (an untruncated PPE run of <O>, ``frontier_peak``)
  repeated on *fresh* random points straight from ``pauliprop``. Exact runs are near-deterministic,
  so the log10 cost must agree within 0.1 decade (pass), 0.5 (warn), else fail; a recorded
  *uncensored* cost that the audit cannot reproduce, or a censored lower bound the audit beats
  by finishing exactly, is a fail.
* ``light_cone_recheck``: the observable's backward light-cone width is recomputed and must equal
  the record (it caps the scored hardness).
* ``interval_consistency``: PPE intervals are nested, so the value at the largest frontier
  must lie inside every smaller-frontier interval of the same point.
* ``fitness_gap``: the audit's own fitness versus the evaluator's.

``audit_fitness`` is the fitness recomputed from the audit's own numbers (fresh variances,
fresh bootstrap seed, fresh cost points) under the same weights. A cost figure is the number of
strings *Pauli propagation* needs; the audit confirms the measurement, not classical hardness.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from kernel.discovery.evaluators._frontier_config import effective_sizes, frontier_cap
from kernel.discovery.evaluators._frontier_cost import clip_interval, scored_hardness
from kernel.discovery.evaluators._frontier_metrics import algebra_verdict, dla_probe, structure_problem
from kernel.discovery.evaluators._frontier_fitness import fitness_terms
from kernel.discovery.evaluators._frontier_observable import frontier_observable, l1_norm
from kernel.discovery.evaluators._frontier_structure import light_cone_width, strip_trivial_prefix
from kernel.discovery.evaluators._frontier_probe import PROBE_POINTS, frontier_grid
from kernel.discovery.evaluators._frontier_trainability import fit_trainability
from kernel.trainability.analyses import gradient_statistics
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.lie import lie_algebra
from kernel.trainability.pauliprop import (
    ppe_applicable, ppe_expectation_bounds, ppe_frontier_curve, ppe_gradient_variances,
)

SAMPLING_MAX_QUBITS = 12
SAMPLING_SAMPLES = 1024
SAMPLING_RETRY_SAMPLES = 4096
Z99_OVER_Z95 = 2.5758 / 1.96
AUDIT_STREAM = 97
AUDIT_SEED_OFFSET = 1009
DLA_AUDIT_MAX_DIMENSION = 8192
DLA_AUDIT_TIME_S = 30.0
NEST_TOL = 1e-9


def _show(value: float | None) -> str:
    return "none" if value is None else f"{value:.4e}"


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
        "probes": recorded.get("dla_probe_qubits") or list(config["dla_probe_qubits"]),
    }


def _reparse_check(circuits: list[ParamCircuit], st: dict[str, Any]) -> dict[str, str]:
    expected = [*st["sizes"]]
    for circuit, n in zip(circuits, expected):
        if circuit.n_qubits != n:
            return _check("reparse", "Artifacts re-parse with the expected widths", "fail",
                          f"build({n}, ...) has {circuit.n_qubits} qubits on re-parse.")
        ok, reason = ppe_applicable(circuit, frontier_observable(st["observable"], n), init="uniform")
        if not ok:
            return _check("reparse", "Artifacts re-parse with the expected widths", "fail",
                          f"n={n}: PPE no longer applies on re-parse: {reason}")
    return _check("reparse", "Artifacts re-parse with the expected widths", "pass",
                  f"{len(circuits)} artifacts re-parsed; PPE applies at every size.")


def _fresh_points(circuits: list[ParamCircuit], st: dict[str, Any], cancel, progress) -> list[dict[str, Any]]:
    """Independent PPE variances. A stopped run's midpoint is not a value (``variance`` is ``None``)."""
    points = []
    for index, (circuit, n) in enumerate(zip(circuits, st["sizes"])):
        result = ppe_gradient_variances(
            circuit, frontier_observable(st["observable"], n), min_weight_abs=0,
            max_frontier=st["max_frontier"], time_budget_s=st["time_budget_s"], cancel=cancel,
        )
        raw = result.get("variance_mean")
        points.append({
            "n_qubits": n, "n_layers": st["n_layers"], "status": result["status"],
            "variance": float(raw) if raw is not None and result["status"] == "complete" else None,
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
        slack = 1e-12 * max(abs(new["variance_ci95"][1]), abs(old["variance_ci95"][1]), 1e-300)
        if new["n_qubits"] != old["n_qubits"] or not _overlap(new["variance_ci95"], old["variance_ci95"], slack):
            return _check("ppe_reproducible", label, "fail", (
                f"n={new['n_qubits']}: fresh PPE interval {new['variance_ci95']} (variance {_show(new['variance'])}) "
                f"disagrees with the recorded {old['variance_ci95']} (variance {_show(old['variance'])})."))
    return _check("ppe_reproducible", label, "pass", "Every fresh variance interval overlaps the recorded one.")


def _sample_ci99(circuit: ParamCircuit, st: dict[str, Any], samples: int, seed: int, cancel) -> tuple[float, list[float]]:
    stats = gradient_statistics(
        circuit, frontier_observable(st["observable"], circuit.n_qubits), samples=samples,
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
            return _check("ppe_vs_sampling", label, "pass", f"n={n}: PPE {_show(claimed['variance'])} vs " + attempts[-1] + ".")
    return _check("ppe_vs_sampling", label, "fail", (
        f"n={n}: the recorded PPE variance {_show(claimed['variance'])} is outside the sampling 99% CI twice: "
        + "; ".join(attempts) + "."))


def _structure_check(circuits: dict[int, ParamCircuit], st: dict[str, Any]) -> dict[str, str]:
    label = "Stripped circuits are connected and consistent at every size"
    problem = structure_problem({n: strip_trivial_prefix(c) for n, c in circuits.items()}, st["n_layers"])
    if problem:
        return _check("structure_recheck", label, "fail", f"The evaluator accepted a degenerate family: {problem}")
    return _check("structure_recheck", label, "pass", f"Sizes {sorted(circuits)} are connected and structurally consistent.")


def _dla_check(probes: list[ParamCircuit], evaluation: dict[str, Any], cancel) -> dict[str, str]:
    label = "Fresh Lie closure agrees with the recorded DLA at every probe size"
    metrics = evaluation.get("metrics") or {}
    recorded_all = metrics.get("dla_probes") or [metrics.get("dla") or {}]
    recorded_by_n = {r.get("probe_qubits"): r for r in recorded_all}
    reached = []
    for probe_circuit in probes:
        n = probe_circuit.n_qubits
        fresh = dla_probe(probe_circuit, cancel)
        fresh_full = lie_algebra(
            probe_circuit, observable=None, max_dimension=DLA_AUDIT_MAX_DIMENSION,
            time_budget_s=DLA_AUDIT_TIME_S, cancel=cancel,
        )
        recorded = recorded_by_n.get(n) or (recorded_all[-1] if n == probes[-1].n_qubits else {})
        old_dim, old_bound = recorded.get("dimension"), recorded.get("dimension_lower_bound")
        if fresh_full["dimension"] is not None and old_dim is not None and fresh_full["dimension"] != old_dim:
            return _check("dla_recheck", label, "fail",
                          f"n={n}: fresh DLA dimension {fresh_full['dimension']} differs from the recorded {old_dim}.")
        if old_bound is not None and fresh_full["dimension"] is not None and fresh_full["dimension"] < old_bound:
            return _check("dla_recheck", label, "fail",
                          f"n={n}: recorded lower bound {old_bound} exceeds the fresh complete dimension {fresh_full['dimension']}.")
        ok, detail = algebra_verdict(probe_circuit, fresh)
        if not ok:
            return _check("dla_recheck", label, "fail", f"The evaluator accepted a trivial algebra: {detail}")
        reached.append(f"n={n}: {fresh_full['dimension_lower_bound']}")
    return _check("dla_recheck", label, "pass", "Fresh closures reach " + ", ".join(reached) + ".")


def _fresh_cost(circuit: ParamCircuit, st: dict[str, Any], seed: int, cancel) -> dict[str, Any]:
    """Untruncated PPE runs of <O> at fresh random points, straight from ``pauliprop``."""
    obs = frontier_observable(st["observable"], circuit.n_qubits)
    rng = np.random.default_rng([abs(int(seed)), AUDIT_STREAM])
    budget = st["time_budget_s"]
    values = rng.uniform(0.0, 2.0 * math.pi, (PROBE_POINTS, len(circuit.parameters)))
    results = []
    for row in values:
        res = ppe_expectation_bounds(
            circuit, obs, row, min_weight_abs=0, max_frontier=st["max_frontier"], time_budget_s=budget, cancel=cancel)
        exact = res["method"] == "pauli_propagation_exact" and res["status"] == "complete"
        peak = max(int(res["frontier_peak"]), 1)
        results.append({"log10_strings": math.log10(peak), "censored": not exact, "status": res["status"]})
    worst = min(results, key=lambda r: r["log10_strings"])
    return {**worst, "nested_bad": _nested_violation(circuit, obs, values[0], st, cancel), "l1": l1_norm(obs)}


def _nested_violation(circuit, obs, row, st, cancel):
    """PPE intervals are nested: the top-frontier value must lie in every smaller interval."""
    budget = st["time_budget_s"]
    bound = l1_norm(obs)
    grid = [s for s in frontier_grid(st["max_frontier"])[:-1]]
    top = ppe_frontier_curve(circuit, obs, row, frontier_sizes=[st["max_frontier"]], time_budget_s=budget, cancel=cancel)[0]
    for size in grid:
        step = ppe_frontier_curve(circuit, obs, row, frontier_sizes=[size], time_budget_s=budget, cancel=cancel)[0]
        lo, hi = clip_interval(step["interval"], bound)[0]
        if not (lo - NEST_TOL <= min(max(top["value"], -bound), bound) <= hi + NEST_TOL):
            return (step["max_frontier"], top["value"], lo, hi)
    return None


def _hardness_check(fresh: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, str]:
    label = "Pauli-propagation exact cost repeats on fresh random points"
    cost = (evaluation.get("metrics") or {}).get("pp_exact_cost") or {}
    recorded = cost.get("log10_strings_lower")
    if recorded is None:
        return _check("hardness_recheck", label, "fail", "The evaluation records no exact cost to audit.")
    gap = abs(fresh["log10_strings"] - recorded)
    claimed_censored = bool(cost.get("censored"))
    detail = (f"recorded {recorded:.3f} ({'censored' if claimed_censored else 'exact'}), fresh points "
              f"{fresh['log10_strings']:.3f} ({'censored' if fresh['censored'] else 'exact'}) log10 strings; "
              f"gap {gap:.3f} decades.")
    if not claimed_censored and fresh["censored"]:
        # a run the audit could not finish: the clock, or a genuinely larger cost
        stopped_by_clock = fresh["status"] != "complete"
        return _check("hardness_recheck", label, "warn" if stopped_by_clock else "fail", detail + (
            " The fresh run was stopped by the clock, so the claim could not be confirmed."
            if stopped_by_clock else " The recorded exact cost is not reproducible."))
    if claimed_censored and not fresh["censored"] and fresh["log10_strings"] < recorded - 0.1:
        return _check("hardness_recheck", label, "fail", detail + " The audit finished exactly below the recorded lower bound.")
    if gap <= 0.1 + 1e-9:
        return _check("hardness_recheck", label, "pass", detail)
    return _check("hardness_recheck", label, "warn" if gap <= 0.5 + 1e-9 else "fail", detail)


def _light_cone_check(circuit: ParamCircuit, st: dict[str, Any], evaluation: dict[str, Any]) -> tuple[dict[str, str], int]:
    label = "Observable light-cone width repeats"
    obs = frontier_observable(st["observable"], circuit.n_qubits)
    width = light_cone_width(strip_trivial_prefix(circuit), obs)["width"]
    metrics = evaluation.get("metrics") or {}
    recorded = (metrics.get("light_cone") or {}).get("width")
    desc = (evaluation.get("descriptors") or {}).get("light_cone_qubits")
    detail = f"fresh width {width}, recorded {recorded}, descriptor {desc}."
    if recorded != width or (desc is not None and desc != width):
        return _check("light_cone_recheck", label, "fail", detail), width
    return _check("light_cone_recheck", label, "pass", detail), width


def _nested_check(fresh: dict[str, Any]) -> dict[str, str]:
    label = "PPE intervals are nested across frontier sizes"
    bad = fresh["nested_bad"]
    if bad is None:
        return _check("interval_consistency", label, "pass", "The top-frontier value lies in every smaller interval.")
    size, value, lo, hi = bad
    return _check("interval_consistency", label, "fail",
                  f"Value {value:.6g} at the top frontier is outside the frontier-{size} interval [{lo:.6g}, {hi:.6g}].")


def _audit_fitness(
    points: list[dict[str, Any]], cost: dict[str, Any], cone_width: int, st: dict[str, Any], seed: int
) -> float:
    fit = fit_trainability(points, seed + AUDIT_SEED_OFFSET)
    hardness = scored_hardness({"log10_strings_lower": cost["log10_strings"]}, cone_width)
    terms = fitness_terms(st["weights"], fit["trainability_term"], hardness["value"], points)
    return float(sum(terms.values()))


def _gap_check(audit_fitness: float, evaluation: dict[str, Any], st: dict[str, Any]) -> dict[str, str]:
    label = "Audit fitness agrees with the evaluator's"
    claimed = evaluation.get("fitness")
    if claimed is None:
        return _check("fitness_gap", label, "skipped", "The evaluation has no fitness.")
    tolerance = st["weights"]["pp_cost"] * 0.5 + 0.1
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
        circuits = _parse(artifacts, len(st["sizes"]) + len(st["probes"]))
    except IrError as exc:
        failed = _check("reparse", "Artifacts re-parse with the expected widths", "fail", f"{exc.code}: {exc.message}")
        return {"checks": [failed], "audit_fitness": None, "notes": []}
    sized, probes = circuits[: len(st["sizes"])], circuits[len(st["sizes"]):]
    checks = [_reparse_check(sized, st)]
    if checks[0]["status"] == "fail":
        return {"checks": checks, "audit_fitness": None, "notes": []}
    recorded = _recorded_points(evaluation)
    fresh = _fresh_points(sized, st, cancel_fn, progress)
    checks.append(_reproducible_check(fresh, recorded))
    checks.append(_sampling_check(sized[0], recorded, st, seed, cancel_fn))
    checks.append(_structure_check({c.n_qubits: c for c in circuits}, st))
    if progress:
        progress(0.5, "re-checking the dynamical Lie algebra")
    checks.append(_dla_check(probes, evaluation, cancel_fn))
    if progress:
        progress(0.7, "re-running the exact-cost probe on fresh points")
    cost = _fresh_cost(sized[-1], st, seed, cancel_fn)
    cone_check, cone_width = _light_cone_check(sized[-1], st, evaluation)
    checks.extend([_hardness_check(cost, evaluation), cone_check, _nested_check(cost)])
    audit_fitness = _audit_fitness(fresh, cost, cone_width, st, seed)
    checks.append(_gap_check(audit_fitness, evaluation, st))
    notes = [
        "The cost is the number of Pauli strings Pauli propagation needs to compute <O> exactly; the "
        "audit re-measures it on fresh points and does not establish classical hardness.",
    ]
    return {"checks": checks, "audit_fitness": audit_fitness, "notes": notes}
