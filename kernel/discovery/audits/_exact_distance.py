"""Exact fault-distance search for the ``qec_memory`` audit (no budget shortcuts).

The search core lives in ``kernel/discovery/distance.py`` (``exact_search``) so
the evaluator's ``confirm`` stage and this audit share one implementation. Its
pruning bounds are the circuit's own largest detector-error-model symptom
degree, so no mechanism is ignored. It is slow by design and runs in a killable
child process.
"""

from __future__ import annotations

from kernel.discovery.distance import ExactResult, exact_search

__all__ = ["ExactResult", "exact_fault_distance"]


def exact_fault_distance(circuit_text: str, budget_s: float, cancel_event=None) -> ExactResult:
    """Run the exact search in a child process; kill it after ``budget_s`` seconds."""
    return exact_search(circuit_text, max(budget_s, 1.0), cancel_event)
