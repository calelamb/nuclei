"""Exact fault-distance search for the ``qec_memory`` audit (no budget shortcuts).

Unlike the evaluator's policy in ``kernel/discovery/distance.py`` (graphlike plus a
pruned search for d > 5), this search sets its pruning bounds to the circuit's
own largest detector-error-model symptom degree, so no mechanism is ignored. It
is slow by design and runs in a killable child process (this file doubles as the
child script: ``python -I _exact_distance.py``).
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class ExactResult:
    weight: int | None  # None: no undetectable logical error exists, or the budget was exceeded
    complete: bool  # False on a budget overrun or a stim failure
    elapsed_s: float
    max_degree: int | None
    note: str | None = None


def _child_main() -> int:
    import stim

    request = json.loads(sys.stdin.read())
    circuit = stim.Circuit(request["circuit_text"])
    degree = 1
    for inst in circuit.detector_error_model().flattened():
        if inst.type == "error":
            symptoms = sum(1 for t in inst.targets_copy() if t.is_relative_detector_id())
            degree = max(degree, symptoms)
    started = time.monotonic()
    try:
        errors = circuit.search_for_undetectable_logical_errors(
            dont_explore_detection_event_sets_with_size_above=degree,
            dont_explore_edges_with_degree_above=degree,
            dont_explore_edges_increasing_symptom_degree=False,
            canonicalize_circuit_errors=True,
        )
        out = {"weight": len(errors), "error": None}
    except ValueError as exc:
        out = {"weight": None, "error": str(exc)[:300]}
    out.update(elapsed_s=time.monotonic() - started, max_degree=degree)
    sys.stdout.write(json.dumps(out))
    return 0


def exact_fault_distance(circuit_text: str, budget_s: float, cancel_event=None) -> ExactResult:
    """Run the exact search in a child process; kill it after ``budget_s`` seconds."""
    import os

    from kernel.discovery.procrun import minimal_env, python_command, run_process

    started = time.monotonic()
    result = run_process(
        python_command(os.path.abspath(__file__)), json.dumps({"circuit_text": circuit_text}).encode(),
        wall_seconds=max(budget_s, 1.0), cancel_event=cancel_event, env=minimal_env(),
        own_group=False,  # killing the audit worker's group also reaps the search
    )
    elapsed = time.monotonic() - started
    if result.cancelled:
        raise InterruptedError("exact fault-distance search cancelled")
    if result.timed_out:
        return ExactResult(None, False, elapsed, None, f"exact search exceeded its {budget_s:.0f} s budget")
    try:
        data = json.loads(result.stdout.decode("utf-8"))
    except ValueError:
        return ExactResult(None, False, elapsed, None, "exact search worker failed")
    weight = data.get("weight")
    # "No logical error" from stim means the observable cannot be flipped at all.
    return ExactResult(weight, True, float(data.get("elapsed_s", elapsed)), data.get("max_degree"), data.get("error"))


if __name__ == "__main__":
    raise SystemExit(_child_main())
