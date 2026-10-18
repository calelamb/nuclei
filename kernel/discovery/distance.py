"""Budgeted fault-distance search (PRD 14 spec 4.1.4 / 6.3 guardrail 10).

Stim's searches are C++ calls with no time limit, so each one runs in a short
child process (this file doubles as the child script: ``python -I distance.py``)
that the parent can kill on budget overrun or cancel.

The pruning bounds come from the circuit itself: every search uses the largest
symptom (detector) degree in the noisy detector error model, capped at
``MAX_SEARCH_DEGREE``. A fixed bound (the old 4/3) is exactly what a hyperedge
cheater hides behind: a bus-qubit fault whose degree-6 symptom decomposes into
three graphlike pairs is counted as three faults by ``shortest_graphlike_error``
and skipped entirely by a degree<=4 search.

Policy:

* ``d <= 5``: exact search (bounds = DEM degree, no symptom-degree pruning) under
  a 10 s budget. Complete result -> verified. On overrun fall back to
  ``shortest_graphlike_error`` and mark the result incomplete.
* ``d > 5``: ``shortest_graphlike_error`` (a real logical error, so an upper
  bound), the fast symptom-degree-pruned search, then the exact search under a
  short ``BOUNDED_EXACT_BUDGET_SECONDS`` slice. Small circuits (repetition codes
  at d=7..11) finish it in milliseconds and come out *verified*; large ones
  (surface code d=7 is ~40 s) do not and are reported incomplete.

Incomplete means "verified only up to the search bounds": the evaluator
penalizes it (``DISTANCE_UNVERIFIED_PENALTY`` in ``qec_memory``) and the
``confirm`` stage re-checks it with ``exact_search`` and a long budget. The
audit uses the same ``exact_search`` core, so evaluator and audit cannot drift.

Results are cached by the structural SHA-256 of the noisy circuit, in memory
and (if a cache dir is given) on disk so separate scorer processes share them.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from dataclasses import asdict, dataclass

EXACT_MAX_DISTANCE = 5
BUDGET_SECONDS = 10.0
#: Exact-search slice for d > 5 in the scorer (honest repetition codes need ~0 s; surface d=7 ~40 s).
BOUNDED_EXACT_BUDGET_SECONDS = 4.0
#: Largest DEM symptom degree the evaluator's searches will honour (the audit/confirm search has no cap).
MAX_SEARCH_DEGREE = 8
#: Budget of the ``confirm``-stage exact verification.
CONFIRM_BUDGET_SECONDS = 120.0
_MODES = ("exact", "graphlike", "pruned")


def max_symptom_degree(circuit) -> int:
    """Largest number of detectors any single error mechanism flips in ``circuit``'s DEM."""
    degree = 1
    for inst in circuit.detector_error_model().flattened():
        if inst.type == "error":
            degree = max(degree, sum(1 for t in inst.targets_copy() if t.is_relative_detector_id()))
    return degree


def _search_kwargs(degree: int, *, prune_increasing: bool) -> dict:
    return dict(
        dont_explore_detection_event_sets_with_size_above=degree,
        dont_explore_edges_with_degree_above=degree,
        dont_explore_edges_increasing_symptom_degree=prune_increasing,
        canonicalize_circuit_errors=True,
    )


@dataclass(frozen=True)
class DistanceResult:
    weight: int | None  # smallest undetectable logical error found; None if none found
    method: str
    complete: bool  # True: finished within its bounds, no overrun
    elapsed_s: float
    note: str | None = None
    max_degree: int | None = None  # largest DEM symptom degree seen (None: not computed)


@dataclass(frozen=True)
class ExactResult:
    """Result of ``exact_search`` (shared by the ``confirm`` stage and the ``qec_memory`` audit)."""

    weight: int | None  # None: no undetectable logical error exists, or the budget was exceeded
    complete: bool  # False on a budget overrun or a stim failure
    elapsed_s: float
    max_degree: int | None
    note: str | None = None


# --- child side -------------------------------------------------------------


def _child_main() -> int:
    import stim

    request = json.loads(sys.stdin.read())
    circuit = stim.Circuit(request["circuit_text"])
    mode = request["mode"]
    cap = request.get("degree_cap")
    started = time.monotonic()
    degree = None
    try:
        if mode == "graphlike":
            errors = circuit.shortest_graphlike_error(ignore_ungraphlike_errors=True)
        else:
            degree = max_symptom_degree(circuit)
            used = min(degree, cap) if cap else degree
            errors = circuit.search_for_undetectable_logical_errors(**_search_kwargs(used, prune_increasing=mode == "pruned"))
        out = {"weight": len(errors), "error": None}
    except ValueError as exc:
        out = {"weight": None, "error": str(exc)[:300]}
    out.update(elapsed_s=time.monotonic() - started, max_degree=degree)
    sys.stdout.write(json.dumps(out))
    return 0


# --- parent side ------------------------------------------------------------

_memory_cache: dict[str, DistanceResult] = {}


def circuit_key(noisy) -> str:
    """Structural SHA-256 of a (noisy) circuit."""
    return hashlib.sha256(str(noisy).encode("utf-8")).hexdigest()


def _disk_path(cache_dir: str, key: str) -> str:
    return os.path.join(cache_dir, f"fault-distance-{key}.json")


def _load(cache_dir: str | None, key: str) -> DistanceResult | None:
    if key in _memory_cache:
        return _memory_cache[key]
    if not cache_dir:
        return None
    try:
        with open(_disk_path(cache_dir, key), encoding="utf-8") as handle:
            data = json.load(handle)
        result = DistanceResult(**data)
    except (OSError, ValueError, TypeError):
        return None
    if not (
        (result.weight is None or isinstance(result.weight, int))
        and isinstance(result.complete, bool)
        and isinstance(result.method, str)
    ):
        return None
    _memory_cache[key] = result
    return result


def _store(cache_dir: str | None, key: str, result: DistanceResult) -> None:
    _memory_cache[key] = result
    if not cache_dir:
        return
    try:
        os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        tmp = _disk_path(cache_dir, key) + f".{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(asdict(result), handle)
        os.replace(tmp, _disk_path(cache_dir, key))
    except OSError:
        pass  # caching is an optimization; never fail the evaluation


def _run_mode(circuit_text: str, mode: str, budget_s: float, cancel_event, degree_cap: int | None = None):
    from kernel.discovery.procrun import minimal_env, python_command, run_process

    payload = json.dumps({"circuit_text": circuit_text, "mode": mode, "degree_cap": degree_cap}).encode()
    result = run_process(
        python_command(os.path.abspath(__file__)), payload,
        wall_seconds=max(budget_s, 0.5), cancel_event=cancel_event, env=minimal_env(),
        own_group=False,  # stay in the scorer's process group so killing the scorer reaps the search
    )
    if result.cancelled:
        raise InterruptedError("fault-distance search cancelled")
    if result.timed_out:
        return None, "timeout"
    try:
        data = json.loads(result.stdout.decode("utf-8"))
    except ValueError:
        return None, "search worker failed"
    return data, None


def fault_distance(noisy, requested_distance: int, *, cache_dir: str | None = None, cancel_event=None) -> DistanceResult:
    """Fault distance of ``noisy`` under the budget policy above (cached)."""
    exact_mode = requested_distance <= EXACT_MAX_DISTANCE
    key = circuit_key(noisy) + (":exact-v2" if exact_mode else ":bounded-v2")
    cached = _load(cache_dir, key)
    if cached is not None:
        return cached
    result = _compute(str(noisy), exact_mode, cancel_event)
    _store(cache_dir, key, result)
    return result


def _compute(text: str, exact_mode: bool, cancel_event) -> DistanceResult:
    started = time.monotonic()

    def elapsed() -> float:
        return time.monotonic() - started

    if exact_mode:
        data, problem = _run_mode(text, "exact", BUDGET_SECONDS, cancel_event, MAX_SEARCH_DEGREE)
        if data is not None:
            return _from_exact(data, "exact_search", elapsed())
        data, _ = _run_mode(text, "graphlike", BUDGET_SECONDS, cancel_event)
        weight = data["weight"] if data else None
        return DistanceResult(weight, "graphlike_after_exact_overrun", False, elapsed(), "exact search exceeded its 10 s budget")
    data, _ = _run_mode(text, "graphlike", BUDGET_SECONDS, cancel_event)
    weights = [data["weight"]] if data and data["weight"] is not None else []
    remaining = max(BUDGET_SECONDS - elapsed(), 1.0)
    pruned, _ = _run_mode(text, "pruned", remaining, cancel_event, MAX_SEARCH_DEGREE)
    if pruned and pruned["weight"] is not None:
        weights.append(pruned["weight"])
    exact, _ = _run_mode(text, "exact", BOUNDED_EXACT_BUDGET_SECONDS, cancel_event, MAX_SEARCH_DEGREE)
    if exact is not None:
        verdict = _from_exact(exact, "graphlike+pruned+exact", elapsed())
        if verdict.weight is not None:
            weights.append(verdict.weight)
        return DistanceResult(min(weights) if weights else None, verdict.method, verdict.complete, elapsed(), verdict.note, verdict.max_degree)
    return DistanceResult(
        min(weights) if weights else None, "graphlike+pruned", False, elapsed(),
        f"bounded search; the exact search exceeded its {BOUNDED_EXACT_BUDGET_SECONDS:.0f} s slice",
    )


def _from_exact(data: dict, method: str, elapsed_s: float) -> DistanceResult:
    note = data["error"]
    degree = data.get("max_degree")
    capped = degree is not None and degree > MAX_SEARCH_DEGREE
    if capped and note is None:
        note = f"symptom degree {degree} exceeds the search cap {MAX_SEARCH_DEGREE}"
    complete = data["weight"] is not None and note is None and not capped
    return DistanceResult(data["weight"], method, complete, elapsed_s, note, degree)


def exact_search(circuit_text: str, budget_s: float, cancel_event=None) -> ExactResult:
    """Exact search with bounds = the circuit's own max symptom degree (no cap), in a killable child.

    Slow by design; used by the ``confirm`` stage and by the ``qec_memory`` audit.
    """
    started = time.monotonic()
    data, problem = _run_mode(circuit_text, "exact", budget_s, cancel_event)
    elapsed = time.monotonic() - started
    if problem == "timeout":
        return ExactResult(None, False, elapsed, None, f"exact search exceeded its {budget_s:.0f} s budget")
    if data is None:
        return ExactResult(None, False, elapsed, None, "exact search worker failed")
    return ExactResult(data.get("weight"), True, float(data.get("elapsed_s", elapsed)), data.get("max_degree"), data.get("error"))


if __name__ == "__main__":
    raise SystemExit(_child_main())
