"""Budgeted fault-distance search (PRD 14 spec 4.1.4 / 6.3 guardrail 10).

Stim's searches are C++ calls with no time limit, so each one runs in a short
child process (this file doubles as the child script: ``python -I distance.py``)
that the parent can kill on budget overrun or cancel.

Policy (measured here: exact search ~0.4 s at d=5, ~48 s at d=7):

* ``d <= 5``: exact ``search_for_undetectable_logical_errors`` (bounds 4/4)
  under a 10 s budget. Complete result -> pass-able without a warning. On a
  budget overrun fall back to ``shortest_graphlike_error`` and mark the result
  incomplete.
* ``d > 5``: ``shortest_graphlike_error`` (finds a real logical error, so it is
  an upper bound on the distance and catches cheaters) plus a pruned search
  (bounds 3/3) under the remaining budget; always incomplete.

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
_EXACT = dict(
    dont_explore_detection_event_sets_with_size_above=4,
    dont_explore_edges_with_degree_above=4,
    dont_explore_edges_increasing_symptom_degree=False,
    canonicalize_circuit_errors=True,
)
_PRUNED = dict(
    dont_explore_detection_event_sets_with_size_above=3,
    dont_explore_edges_with_degree_above=3,
    dont_explore_edges_increasing_symptom_degree=True,
    canonicalize_circuit_errors=True,
)
_MODES = ("exact", "graphlike", "pruned")


@dataclass(frozen=True)
class DistanceResult:
    weight: int | None  # smallest undetectable logical error found; None if none found
    method: str
    complete: bool  # True: finished within its bounds, no overrun
    elapsed_s: float
    note: str | None = None


# --- child side -------------------------------------------------------------


def _child_main() -> int:
    import stim

    request = json.loads(sys.stdin.read())
    circuit = stim.Circuit(request["circuit_text"])
    mode = request["mode"]
    started = time.monotonic()
    try:
        if mode == "graphlike":
            errors = circuit.shortest_graphlike_error(ignore_ungraphlike_errors=True)
        else:
            errors = circuit.search_for_undetectable_logical_errors(**(_EXACT if mode == "exact" else _PRUNED))
        out = {"weight": len(errors), "error": None}
    except ValueError as exc:
        out = {"weight": None, "error": str(exc)[:300]}
    out["elapsed_s"] = time.monotonic() - started
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


def _run_mode(circuit_text: str, mode: str, budget_s: float, cancel_event):
    from kernel.discovery.procrun import minimal_env, python_command, run_process

    payload = json.dumps({"circuit_text": circuit_text, "mode": mode}).encode()
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
    key = circuit_key(noisy) + (":exact" if exact_mode else ":bounded")
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
        data, problem = _run_mode(text, "exact", BUDGET_SECONDS, cancel_event)
        if data is not None:
            note = data["error"]
            return DistanceResult(data["weight"], "exact_search", data["weight"] is not None and note is None, elapsed(), note)
        data, _ = _run_mode(text, "graphlike", BUDGET_SECONDS, cancel_event)
        weight = data["weight"] if data else None
        return DistanceResult(weight, "graphlike_after_exact_overrun", False, elapsed(), "exact search exceeded its 10 s budget")
    data, _ = _run_mode(text, "graphlike", BUDGET_SECONDS, cancel_event)
    weights = [data["weight"]] if data and data["weight"] is not None else []
    remaining = max(BUDGET_SECONDS - elapsed(), 1.0)
    pruned, _ = _run_mode(text, "pruned", remaining, cancel_event)
    if pruned and pruned["weight"] is not None:
        weights.append(pruned["weight"])
    return DistanceResult(min(weights) if weights else None, "graphlike+pruned", False, elapsed(), "bounded search")


if __name__ == "__main__":
    raise SystemExit(_child_main())
