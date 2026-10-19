"""Audit for the ``qec_memory`` evaluator (addendum section F).

Independent of the evaluator in four ways:

* the circuit text is re-parsed from scratch from a fresh sandbox run;
* every guardrail is re-run under a DIFFERENT noise model (si1000 <-> uniform,
  biased_z -> uniform) and a different seed;
* fault distance (d <= 7) is searched EXACTLY with no pruning (long budget);
* the logical error rate is re-sampled independently and must agree with the
  evaluator's interval; the alternate-model rate gives ``audit_fitness``.
"""

from __future__ import annotations

import math
import threading
from typing import Any, Callable

from kernel.discovery._optional import lazy_module
from kernel.discovery.audits._common import (
    FAIL, PASS, SKIPPED, WARN, aggregate, check, guarded, not_reached, result, scored_metric,
)
from kernel.discovery.audits._common import derive_seed
from kernel.discovery.audits._exact_distance import exact_fault_distance
from kernel.discovery.evaluators.qec_guardrails import (
    Case, check_decodable, check_duration, check_gate_set, check_has_observable, check_noiseless,
    check_nontrivial_observable, check_parse, check_qubit_budget, _canonical_gate,
)
from kernel.discovery.evaluators.qec_memory import FITNESS_FLOOR
from kernel.discovery.evaluators.qec_stats import round_summary, sample_logical_errors

stim = lazy_module("stim")  # optional (Research catalog); imported on first use

ALT_MODEL = {"si1000": "uniform", "uniform": "si1000", "biased_z": "uniform"}
EXACT_MAX_DISTANCE = 7
EXACT_BUDGET_SECONDS = 120.0
AUDIT_DETERMINISM_SHOTS = 256
MODEL_GAP_WARN_DECADES = 1.5


def _rounds(config: dict[str, Any], distance: int) -> int:
    return distance if config["rounds"] == "d" else int(config["rounds"])


def _new_cases(config: dict[str, Any], artifacts: list[dict[str, Any]]) -> list[Case]:
    by_index = {a.get("call_index"): a.get("artifact") for a in artifacts}
    cases = []
    for index, d in enumerate(config["distances"]):
        artifact = by_index.get(index)
        if not isinstance(artifact, dict) or not isinstance(artifact.get("circuit_text"), str):
            raise ValueError(f"fresh sandbox run has no circuit_text for call {index}")
        cases.append(Case(d, _rounds(config, d), artifact["circuit_text"]))
    return cases


def _noisy(case: Case, noise: dict[str, Any]) -> stim.Circuit:
    from kernel.discovery.noise import apply_noise

    if case.noisy is None:
        case.noisy = apply_noise(case.circuit, noise["model"], noise["p"], noise.get("bias", 10.0))
    return case.noisy


def _check_deterministic(case: Case, noise: dict[str, Any], seed: int) -> tuple[str, str | None]:
    try:
        case.circuit.detector_error_model()
        det, obs = case.circuit.compile_detector_sampler(seed=derive_seed(seed, f"det{case.distance}")).sample(
            AUDIT_DETERMINISM_SHOTS, separate_observables=True
        )
        if det.any() or obs.any():
            return FAIL, f"{case.tag}: noiseless sample is not all zero (non-deterministic detectors/observables)."
        _noisy(case, noise).detector_error_model()
    except ValueError as exc:
        return FAIL, f"{case.tag}: detectors/observables are not deterministic: {' '.join(str(exc).split())[:300]}"
    return PASS, None


def _check_flippable(case: Case) -> tuple[str, str | None]:
    flippable: set[int] = set()
    for inst in case.dem.flattened():
        if inst.type == "error":
            flippable.update(t.val for t in inst.targets_copy() if t.is_logical_observable_id())
    missing = sorted(set(range(case.circuit.num_observables)) - flippable)
    if missing:
        return FAIL, f"{case.tag}: observable(s) {missing} can never be flipped by any error mechanism."
    return PASS, None


def _check_exact_distance(case: Case, cancel: threading.Event | None, notes: list[str]) -> tuple[str, str | None]:
    if case.distance > EXACT_MAX_DISTANCE:
        return WARN, f"{case.tag}: exact search is only run for d <= {EXACT_MAX_DISTANCE}; distance unverified."
    found = exact_fault_distance(str(case.noisy), EXACT_BUDGET_SECONDS, cancel)
    if not found.complete:
        return SKIPPED, f"{case.tag}: {found.note}."
    if found.weight is None:
        return WARN, f"{case.tag}: exact search found no undetectable logical error ({found.note})."
    notes.append(f"{case.tag}: exact fault distance {found.weight} in {found.elapsed_s:.1f}s (symptom degree <= {found.max_degree})")
    if found.weight < case.distance:
        return FAIL, (
            f"Requested d={case.distance} but the exact search found an undetectable logical error of weight "
            f"{found.weight} (no pruning)."
        )
    return PASS, None


def _fitness(summaries: list[dict[str, Any]]) -> float:
    return sum(-math.log10(max(s["ci95"][1], FITNESS_FLOOR)) for s in summaries) / len(summaries)


def _sample(case: Case, config: dict[str, Any], seed: int, tag: str, cancel) -> dict[str, Any]:
    shots_cfg = config["shots"]
    shots, errors = sample_logical_errors(
        case.noisy, case.dem, seed=derive_seed(seed, f"{tag}{case.distance}"),
        min_shots=shots_cfg["min"], max_shots=shots_cfg["max"], max_errors=shots_cfg["max_errors"], cancel=cancel,
    )
    return {"d": case.distance, "shots": shots, "errors": errors, **round_summary(errors, shots, case.rounds)}


def _intervals_overlap(a: list[float], b: list[float]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


def _check_ler(matched: list[dict[str, Any]], evaluation: dict[str, Any]) -> tuple[str, str | None]:
    reported = scored_metric(evaluation, "per_distance")
    if not isinstance(reported, list) or len(reported) != len(matched):
        return SKIPPED, "the evaluation carries no per-distance LER intervals to compare with."
    for mine, theirs in zip(matched, reported):
        if not _intervals_overlap(mine["ci95"], theirs["ci95"]):
            return FAIL, (
                f"d={mine['d']}: independent per-round LER interval {mine['ci95']} does not overlap the "
                f"evaluator's {theirs['ci95']}."
            )
    return PASS, None


def _fault_distance_agrees(evaluation: dict[str, Any], cases: list[Case]) -> tuple[str, str | None]:
    reported = scored_metric(evaluation, "per_distance")
    if not isinstance(reported, list):
        return SKIPPED, "no evaluator fault distances to compare."
    for case, row in zip(cases, reported):
        claimed = row.get("fault_distance")
        if claimed is not None and claimed < case.distance:
            return FAIL, f"d={case.distance}: the evaluator itself recorded fault distance {claimed}."
    return PASS, None


def audit(
    config: dict[str, Any],
    artifacts: list[dict[str, Any]],
    seed: int,
    *,
    evaluation: dict[str, Any],
    progress: Callable[[float, str], None] | None = None,
    cancel: threading.Event | None = None,
    cache_dir: str | None = None,
) -> dict[str, Any]:
    notes: list[str] = []
    noise = config["noise"]
    alt = {**noise, "model": ALT_MODEL[noise["model"]]}
    notes.append(f"guardrails re-run under {alt['model']} (evaluator used {noise['model']}); fresh seed")
    try:
        alt_cases = _new_cases(config, artifacts)
        matched_cases = _new_cases(config, artifacts)
    except ValueError as exc:
        return result([check("parse", "Circuit re-parsed from scratch", FAIL, str(exc))], None, notes)
    checks: list[dict[str, Any]] = []
    allowed = {_canonical_gate(g) for g in config["allowed_gates"]}

    def run(check_id: str, label: str, cases: list[Case], fn) -> bool:
        record = guarded(check_id, label, lambda: aggregate(cases, fn))
        checks.append(record)
        return record["status"] != FAIL

    if not run("parse", "Circuit re-parsed from scratch", alt_cases, check_parse):
        for cid, label in (("noiseless", "No candidate noise"), ("exact_fault_distance", "Exact fault distance")):
            checks.append(not_reached(cid, label, "the circuit does not parse"))
        return result(checks, None, notes)
    for case, other in zip(alt_cases, matched_cases):
        other.circuit = case.circuit
    run("noiseless", "Candidate emits noiseless circuits", alt_cases, check_noiseless)
    run("gate_set", "Only allowed gates are used", alt_cases, lambda c: check_gate_set(c, allowed))
    run("qubit_budget", "Qubit and size budget respected", alt_cases, lambda c: check_qubit_budget(c, config["max_qubits"]))
    run("has_observable", "Every observable has measurement targets", alt_cases, check_has_observable)
    run("deterministic", f"Deterministic under {alt['model']} noise", alt_cases, lambda c: _check_deterministic(c, alt, seed))
    run("duration", "Circuit lasts at least the requested rounds", alt_cases, check_duration)
    decodable = run(
        "decodable", f"Decodable under {alt['model']} noise", alt_cases,
        lambda c: _decodable(c, alt),
    )
    for case in alt_cases:  # the exact search needs only the noisy circuit, never a decodable model
        try:
            _noisy(case, alt)
        except ValueError:
            break  # the exact-search check then reports that it could not run
    run("exact_fault_distance", "Exact fault distance (no pruning)", alt_cases,
        lambda c: _check_exact_distance(c, cancel, notes))
    if decodable:
        run("nontrivial_observable", "Observable can be flipped", alt_cases, check_nontrivial_observable)
        run("observables_flippable", "Every observable is flippable", alt_cases, _check_flippable)
    run("evaluator_fault_distance", "Evaluator's recorded distance is honest", alt_cases,
        lambda c: _fault_distance_agrees(evaluation, alt_cases))
    fitness = _sampling_checks(checks, config, noise, alt, alt_cases, matched_cases, seed, evaluation, cancel, notes, decodable)
    return result(checks, fitness, notes)


def _decodable(case: Case, alt: dict[str, Any]) -> tuple[str, str | None]:
    _noisy(case, alt)
    return check_decodable(case, alt)


def _sampling_checks(
    checks, config, noise, alt, alt_cases, matched_cases, seed, evaluation, cancel, notes, decodable
) -> float | None:
    if not decodable:
        checks.append(not_reached("ler_matches_evaluator", "Independent LER agrees", "the error model is not decodable"))
        return None
    matched_ok = guarded("matched_model", f"Decode under the evaluator's {noise['model']} model", lambda: _prepare(matched_cases, noise))
    if matched_ok["status"] == PASS:
        matched = [_sample(c, config, seed, "matched", cancel) for c in matched_cases]
        checks.append(guarded("ler_matches_evaluator", "Independent LER interval overlaps the evaluator's",
                              lambda: _check_ler(matched, evaluation)))
    else:
        checks.append(matched_ok)
    summaries = [_sample(c, config, seed, "alt", cancel) for c in alt_cases]
    fitness = _fitness(summaries)
    notes.append(f"LER re-scored under {alt['model']}: " + ", ".join(
        f"d={s['d']}: {s['ler_round']:.3e}" for s in summaries))
    reported = evaluation.get("fitness") if isinstance(evaluation, dict) else None
    detail = None
    status = PASS
    if isinstance(reported, (int, float)) and reported - fitness > MODEL_GAP_WARN_DECADES:
        status, detail = WARN, f"score drops by {reported - fitness:.2f} decades under {alt['model']} noise."
    checks.append(check("model_robustness", f"Score under {alt['model']} noise", status, detail))
    return float(fitness)


def _prepare(cases: list[Case], noise: dict[str, Any]) -> tuple[str, str | None]:
    for case in cases:
        case.noisy = None
        _noisy(case, noise)
        status, detail = check_decodable(case, noise)
        if status != PASS:
            return FAIL, detail
    return PASS, None
