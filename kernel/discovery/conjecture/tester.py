"""Test a conjecture on held-out circuits (addendum section G).

``test_conjecture`` draws ``circuits`` fresh members of the conjecture's test
family (resampling any that violate its ``feature_predicate``), runs an exact
barren-plateau scaling study on each (Pauli Propagation up to 128 qubits;
sampling only for n <= 12 when the PPE does not apply) and judges the
prediction per circuit with the interval semantics of :mod:`.semantics`.

Verdict and honesty rules:

* ``supported``: every one of the requested circuits meets the prediction
  within its intervals. The summary says "supported on N held-out circuits up
  to n = X"; a conjecture is never "proven".
* ``refuted``: at least one circuit violates it. Each violator is a
  counterexample with its family parameters, regenerable seed and IR JSON. A
  counterexample stands even if a budget later ran out, because the violation
  is already established by rigorous intervals.
* ``inconclusive``: anything else: indeterminate circuits, a family that cannot
  realize the predicate, or a time-budget overrun (reported with the partial
  evidence collected so far).

Features used for the predicate are measured at the largest tested n. Wall
time is bounded per circuit and in total.
"""

from __future__ import annotations

import math
import time
from typing import Any, Callable

from kernel.discovery.conjecture import predicate as pred
from kernel.discovery.conjecture.grammar import GrammarError, build_variant, family_observable
from kernel.discovery.conjecture.semantics import (
    INDETERMINATE, MEETS, VIOLATES, evaluate_prediction, point_is_loose,
)
from kernel.discovery.conjecture.spec import prediction_text, qubit_counts, validate_conjecture
from kernel.discovery.features import extract_features
from kernel.trainability._analysis_common import AnalysisCancelled, AnalysisError
from kernel.trainability.analyses import gradient_statistics
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.lie import lie_algebra
from kernel.trainability.pauliprop import ppe_applicable, ppe_gradient_variances
from kernel.trainability.scaling import fit_scaling

MAX_SAMPLING_QUBITS = 12
SAMPLES = 200
MAX_FRONTIER = 500_000
RESAMPLE_FACTOR = 25
IR_MAX_GATES = 4000
DLA_BUDGET_S = 20.0
UNREALIZABLE = "family does not realize the predicate"

Progress = Callable[[float, str, int], None]


class _Budget:
    """Per-circuit and total wall-clock accounting."""

    def __init__(self, per_circuit_s: float, total_s: float) -> None:
        self.per_circuit_s, self.total_s = per_circuit_s, total_s
        self.start = time.monotonic()
        self.circuit_start = self.start

    def begin_circuit(self) -> None:
        self.circuit_start = time.monotonic()

    def total_left(self) -> float:
        return self.total_s - (time.monotonic() - self.start)

    def left(self) -> float:
        return min(self.per_circuit_s - (time.monotonic() - self.circuit_start), self.total_left())


def _check(cancel: Callable[[], bool] | None) -> None:
    if cancel is not None and cancel():
        raise AnalysisCancelled()


def _ppe_point(circuit: ParamCircuit, obs, n: int, budget: float, cancel) -> dict[str, Any]:
    res = ppe_gradient_variances(circuit, obs, min_weight_abs=0, max_frontier=MAX_FRONTIER,
                                 time_budget_s=max(budget, 0.01), cancel=cancel)
    if res["status"] == "cancelled":
        raise AnalysisCancelled()
    variance, interval = float(res["variance_mean"]), [float(x) for x in res["variance_mean_interval"]]
    return {"n_qubits": n, "n_params": len(circuit.parameters), "variance": variance, "interval": interval,
            "method": "ppe", "status": res["status"], "loose": point_is_loose(variance, interval, res["status"]),
            "frontier_peak": res.get("frontier_peak"), "error": None}


def _sampling_point(circuit: ParamCircuit, obs, n: int, seed: int, cancel) -> dict[str, Any]:
    res = gradient_statistics(circuit, obs, samples=SAMPLES, seed=seed, init="uniform", method="sampling",
                              cancel=cancel)
    return {"n_qubits": n, "n_params": len(circuit.parameters), "variance": float(res["variance_mean"]),
            "interval": [float(x) for x in res["variance_mean_ci95"]], "method": "sampling",
            "status": "complete", "loose": False, "frontier_peak": None, "error": None}


def _error_point(n: int, code: str, message: str) -> dict[str, Any]:
    return {"n_qubits": n, "n_params": None, "variance": None, "interval": None, "method": None,
            "status": "error", "loose": False, "frontier_peak": None,
            "error": {"code": code, "message": message[:300]}}


def _run_point(family, n, seed, variant, budget: _Budget, point_seed: int, cancel) -> dict[str, Any]:
    t0 = time.perf_counter()
    try:
        circuit, _ = build_variant(family, n, seed, variant)
        obs = family_observable(family, n)
        ok, reason = ppe_applicable(circuit, obs, init="uniform")
        if ok:
            point = _ppe_point(circuit, obs, n, budget.left(), cancel)
        elif n <= MAX_SAMPLING_QUBITS:
            point = _sampling_point(circuit, obs, n, point_seed, cancel)
        else:
            point = _error_point(n, "ppe_required", f"the PPE does not apply ({reason}) and n > {MAX_SAMPLING_QUBITS}")
    except AnalysisCancelled:
        raise
    except (AnalysisError, IrError, GrammarError) as exc:
        point = _error_point(n, getattr(exc, "code", "grammar"), getattr(exc, "message", str(exc)))
    return {**point, "elapsed_ms": int((time.perf_counter() - t0) * 1000)}


def _dla(family, probe_n: int, seed: int, variant: int, budget: _Budget, cancel) -> dict[str, Any]:
    try:
        circuit, _ = build_variant(family, probe_n, seed, variant)
        res = lie_algebra(circuit, time_budget_s=max(min(DLA_BUDGET_S, budget.left()), 0.01), cancel=cancel)
    except AnalysisCancelled:
        raise
    except (AnalysisError, IrError, GrammarError) as exc:
        return {"probe_n": probe_n, "dimension": None, "log2_interval": None,
                "error": getattr(exc, "message", str(exc))}
    dim, lower = res.get("dimension"), res.get("dimension_lower_bound")
    if dim:
        interval = [math.log2(dim), math.log2(dim)]
    elif lower:
        interval = [math.log2(lower), None]
    else:
        interval = None
    return {"probe_n": probe_n, "dimension": dim, "dimension_lower_bound": lower, "status": res.get("status"),
            "classification": res.get("classification"), "log2_interval": interval, "error": None}


def _ir_for(family, n_range, seed, variant) -> tuple[dict[str, Any], int]:
    circuit, _ = build_variant(family, n_range[1], seed, variant)
    if len(circuit.gates) > IR_MAX_GATES:
        circuit, _ = build_variant(family, n_range[0], seed, variant)
    return circuit.to_json(), circuit.n_qubits


def _evaluate_circuit(conj, ns, seed, variant, info, features, index, budget: _Budget, cancel,
                      progress: Progress | None) -> dict[str, Any]:
    family, prediction = conj["test_family"], conj["prediction"]
    t0 = time.perf_counter()
    points: list[dict[str, Any]] = []
    timed_out = False
    for k, n in enumerate(ns):
        _check(cancel)
        if budget.left() <= 0:
            timed_out = True
            break
        if progress:
            progress((index + k / len(ns)) / conj["circuits"], f"circuit {index + 1}/{conj['circuits']}, n = {n}", index)
        points.append(_run_point(family, n, seed, variant, budget, (seed * 1_000_003 + variant * 101 + n) % 2**32, cancel))
    good = [p for p in points if p["error"] is None]
    fit = (fit_scaling([{"n_qubits": p["n_qubits"], "variance": p["variance"], "interval": p["interval"]}
                        for p in good], seed=seed + index) or [None])[0] if len(good) == len(ns) else None
    dla = None
    if prediction["quantity"] == "log2_dla_dimension" and not timed_out:
        dla = _dla(family, conj["dla_probe_qubits"], seed, variant, budget, cancel)
    observed = {
        "beta_ci95": (fit or {}).get("exponential", {}) and fit["exponential"]["beta_ci95"] or None,
        "fit_verdict": fit["verdict"] if fit else None, "fit_summary": fit["summary"] if fit else None,
        "max_n_interval": next((p["interval"] for p in good if p["n_qubits"] == ns[-1]), None),
        "log2_dla_interval": dla["log2_interval"] if dla else None, "max_n": ns[-1],
        "loose_points": [p["n_qubits"] for p in good if p["loose"]],
        "errors": [{"n_qubits": p["n_qubits"], **p["error"]} for p in points if p["error"]],
    }
    outcome, value, reason = evaluate_prediction(prediction, observed)
    if timed_out and outcome != VIOLATES:
        outcome, reason = INDETERMINATE, "the per-circuit or total time budget ran out before every point finished"
    return {
        "circuit_index": index, "variant_id": f"v{variant}", "family_params": info, "features": features,
        "regenerate": {"seed": seed, "variant": variant, "test_family": family},
        "points": points, "fit": fit, "dla": dla, "quantity": {**prediction, "observed": value},
        "outcome": outcome, "meets": {MEETS: True, VIOLATES: False}.get(outcome), "reason": reason,
        "timed_out": timed_out, "elapsed_ms": int((time.perf_counter() - t0) * 1000),
    }


def _select_circuits(conj, seed, cancel) -> tuple[list[tuple[int, dict, dict]], dict[str, Any]]:
    """Resample family members until ``circuits`` satisfy the predicate (or the cap is hit)."""
    family, n_max = conj["test_family"], conj["n_range"][1]
    cap = max(40, conj["circuits"] * RESAMPLE_FACTOR)
    chosen: list[tuple[int, dict, dict]] = []
    rejected = attempts = 0
    while len(chosen) < conj["circuits"] and attempts < cap:
        _check(cancel)
        circuit, info = build_variant(family, n_max, seed, attempts)
        features = extract_features(circuit, n_layers=info["layers"])
        if pred.evaluate(conj["feature_predicate"], features):
            chosen.append((attempts, info, features))
        else:
            rejected += 1
        attempts += 1
    return chosen, {"attempts": attempts, "accepted": len(chosen), "rejected": rejected, "cap": cap}


def assemble_result(conj: dict[str, Any], evidence: list[dict[str, Any]], *, seed: int, ns: list[int],
                    resampling: dict[str, Any], stop_reason: str | None, elapsed_ms: int) -> dict[str, Any]:
    """Build the result dict from the evidence so far (also used for partial results)."""
    tally = {o: sum(1 for e in evidence if e["outcome"] == o) for o in (MEETS, VIOLATES, INDETERMINATE)}
    counterexamples = []
    for e in evidence:
        if e["outcome"] == VIOLATES:
            ir, ir_n = _ir_for(conj["test_family"], conj["n_range"], seed, e["regenerate"]["variant"])
            counterexamples.append({k: e[k] for k in ("circuit_index", "variant_id", "family_params", "features",
                                                      "regenerate", "points", "fit", "quantity", "reason")}
                                   | {"ir": ir, "ir_n_qubits": ir_n})
    total, n_max, text = len(evidence), ns[-1], prediction_text(conj["prediction"])
    reasons: list[str] = []
    if stop_reason:
        reasons.append(stop_reason)
    if tally[VIOLATES]:
        verdict = "refuted"
        first = counterexamples[0]
        summary = (f"Refuted: {tally[VIOLATES]} of {total} held-out circuits tested violate '{text}'. "
                   f"First counterexample: {first['variant_id']} (see counterexamples).")
    elif not stop_reason and total == conj["circuits"] and tally[MEETS] == total:
        verdict = "supported"
        summary = (f"Conjecture supported on {total} held-out circuits up to n = {n_max}: '{text}' held for every "
                   "circuit within its 95% interval. This is evidence on sampled circuits, not a guarantee.")
    else:
        verdict = "inconclusive"
        if tally[INDETERMINATE]:
            reasons.append(f"{tally[INDETERMINATE]} circuit(s) were indeterminate")
        if not stop_reason and total < conj["circuits"]:
            reasons.append(f"only {total} of {conj['circuits']} circuits were tested")
        summary = (f"Inconclusive: {'; '.join(reasons) or 'no decisive evidence'}. Of {total} held-out circuits "
                   f"tested up to n = {n_max}, {tally[MEETS]} met '{text}', {tally[INDETERMINATE]} were "
                   "indeterminate.")
    return {
        "conjecture_id": conj["id"], "verdict": verdict, "summary": summary, "reasons": reasons,
        "partial": bool(stop_reason), "tally": tally, "n_circuits_requested": conj["circuits"],
        "n_circuits_tested": total, "n_range": conj["n_range"], "n_values": ns, "n_max_tested": n_max,
        "counterexamples": counterexamples, "evidence": evidence, "resampling": resampling, "seed": seed,
        "timings": {"elapsed_ms": elapsed_ms}, "conjecture": conj,
    }


def partial_result(conjecture: dict[str, Any], evidence: list[dict[str, Any]], reason: str, *, seed: int,
                   elapsed_ms: int = 0) -> dict[str, Any]:
    """Result built from evidence gathered before a stop (cancel, crash, wall limit): never ``supported``."""
    conj = validate_conjecture(conjecture)
    ns = qubit_counts(conj["n_range"], conj["points"])
    return assemble_result(conj, evidence, seed=seed, ns=ns, resampling={}, stop_reason=reason,
                           elapsed_ms=elapsed_ms)


def test_conjecture(
    conjecture: dict[str, Any], *, seed: int = 0, progress: Progress | None = None,
    cancel: Callable[[], bool] | None = None, on_evidence: Callable[[dict], None] | None = None,
    per_circuit_budget_s: float | None = None, total_budget_s: float | None = None,
) -> dict[str, Any]:
    """Test ``conjecture`` and return its result (see the module docstring).

    ``progress(fraction, message, circuit_index)`` and ``on_evidence(item)`` stream while it runs.
    Raises :class:`SpecError` for a malformed conjecture and
    :class:`~kernel.trainability._analysis_common.AnalysisCancelled` when ``cancel`` fires.
    """
    conj = validate_conjecture(conjecture)
    t0 = time.perf_counter()
    budget = _Budget(per_circuit_budget_s if per_circuit_budget_s is not None else conj["budget"]["per_circuit_s"],
                     total_budget_s if total_budget_s is not None else conj["budget"]["total_s"])
    ns = qubit_counts(conj["n_range"], conj["points"])

    def elapsed() -> int:
        return int((time.perf_counter() - t0) * 1000)

    try:
        chosen, resampling = _select_circuits(conj, seed, cancel)
    except GrammarError as exc:
        return assemble_result(conj, [], seed=seed, ns=ns, resampling={}, elapsed_ms=elapsed(),
                               stop_reason=f"the family cannot be generated: {exc}")
    if len(chosen) < conj["circuits"]:
        return assemble_result(
            conj, [], seed=seed, ns=ns, resampling=resampling, elapsed_ms=elapsed(),
            stop_reason=f"{UNREALIZABLE}: {len(chosen)} of {conj['circuits']} circuits satisfied it in "
                        f"{resampling['attempts']} draws")
    evidence: list[dict[str, Any]] = []
    stop_reason = None
    for index, (variant, info, features) in enumerate(chosen):
        if budget.total_left() <= 0:
            stop_reason = "the total time budget was exhausted"
            break
        budget.begin_circuit()
        item = _evaluate_circuit(conj, ns, seed, variant, info, features, index, budget, cancel, progress)
        evidence.append(item)
        if on_evidence:
            on_evidence(item)
        if budget.total_left() <= 0 and index + 1 < len(chosen):
            stop_reason = "the total time budget was exhausted"
            break
    if progress:
        progress(1.0, "done", max(len(evidence) - 1, 0))
    return assemble_result(conj, evidence, seed=seed, ns=ns, resampling=resampling, stop_reason=stop_reason,
                           elapsed_ms=elapsed())
