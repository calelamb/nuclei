"""Algebra probe, interaction structure and the PPE gradient map for ``trainability_frontier``."""

from __future__ import annotations

import math
from typing import Any

from kernel.discovery.evaluators._frontier_structure import (
    Stripped,
    consistency_problem,
    interaction_blocks,
    signature,
    strip_trivial_prefix,
)
from kernel.trainability.ir import ParamCircuit, ParamRef
from kernel.trainability.lie import lie_algebra

DEAD_VARIANCE = 1e-8
DLA_MAX_DIMENSION = 4096
DLA_TIME_BUDGET_S = 10.0
ALGEBRA_CAP_FACTOR = 4  # threshold = 4 n^2


def dla_probe(circuit: ParamCircuit, cancel=None) -> dict[str, Any]:
    """DLA dimension (lower bound when the closure did not finish) and classification."""
    result = lie_algebra(
        circuit, observable=None, max_dimension=DLA_MAX_DIMENSION, time_budget_s=DLA_TIME_BUDGET_S,
        cancel=cancel,
    )
    bound = result["dimension_lower_bound"]
    dimension = result["dimension"] if result["dimension"] is not None else bound
    return {
        "probe_qubits": circuit.n_qubits, "status": result["status"], "dimension": result["dimension"],
        "dimension_lower_bound": bound, "classification": result["classification"],
        "log2_dimension": math.log2(max(dimension or 1, 1)),
        "threshold": algebra_threshold(circuit.n_qubits),
    }


def algebra_threshold(n_qubits: int) -> int:
    """The DLA dimension a probe must exceed: ``4 n^2``, the Lab's own g-sim feasibility cap.

    Known efficiently classically simulable families all sit below it at every n: product
    circuits (su(2)^n, dimension 3n), free-fermion / matchgate circuits (n(2n-1) < 2n^2), and
    anything else the Lab reports as ``g_sim_feasible`` (``kernel.trainability.lie``). A DLA at or
    below ``4 n^2`` is polynomial, so the candidate is simulable in poly(dim g) time whenever the
    observable lies in g; a counterexample hunt has no use for it. The old ``2n`` threshold let a
    product circuit (3n) through.
    """
    return ALGEBRA_CAP_FACTOR * n_qubits * n_qubits


def algebra_verdict(
    circuit: ParamCircuit, probe: dict[str, Any], stripped: Stripped | None = None,
) -> tuple[bool, str]:
    """``(ok, detail)`` for one probe size: dimension above ``4n^2`` and no product structure."""
    n = circuit.n_qubits
    bound = probe["dimension_lower_bound"] or 0
    label = probe["classification"]["label"]
    limit = algebra_threshold(n)
    reached = "" if probe["status"] == "complete" else " (closure incomplete, lower bound)"
    if bound <= limit:
        return False, (
            f"At n={n} the dynamical Lie algebra has dimension {bound}{reached} <= 4n^2={limit} "
            f"(classification: {label}); product, free-fermion and other polynomial-algebra ansatzes "
            "are trivially trainable and classically simulable."
        )
    blocks = interaction_blocks(stripped or strip_trivial_prefix(circuit))
    if len(blocks) > 1:
        return False, _blocks_detail(n, len(blocks), f"algebra dimension {bound}{reached}, classification: {label}")
    return True, f"n={n}: DLA dimension {bound}{reached} > 4n^2={limit} (classification: {label})."


def _blocks_detail(n: int, count: int, extra: str = "") -> str:
    tail = f" ({extra})" if extra else ""
    return (
        f"At n={n} the entangling gates (after removing gates that act trivially on |0...0>) split the "
        f"qubits into {count} independent blocks, so the circuit is a tensor product{tail}; "
        "it is trivially simulable block by block."
    )


def structure_problem(
    stripped: dict[int, Stripped], n_layers: int,
) -> str | None:
    """Per-size product test and cross-size consistency; ``None`` when every size is acceptable.

    ``stripped`` maps each scored and probe size to its stripped circuit (see ``_frontier_structure``).
    """
    for n, item in sorted(stripped.items()):
        blocks = interaction_blocks(item)
        if len(blocks) > 1:
            return _blocks_detail(n, len(blocks))
    problem = consistency_problem([signature(item, n_layers) for _, item in sorted(stripped.items())])
    if problem:
        return (
            f"The ansatz family is not structurally consistent across sizes {sorted(stripped)}: {problem}. "
            "A build(n, L) that changes character with n cannot be certified from the sizes it was probed at."
        )
    return None


def two_qubit_gates_per_layer(features: dict[str, Any]) -> float:
    return float(features.get("two_qubit_gates_per_layer", 0.0))


def ppe_gradient_map(
    circuit: ParamCircuit, point: dict[str, Any], observable_text: str,
) -> dict[str, Any]:
    """Addendum-C map from the exact PPE per-parameter rows (``point["per_parameter"]``).

    Lines come from ``IrGate.source_line``; gates with no recovered line are omitted, never
    guessed. A line is dead only when every parameter created there is dead (variance below
    1e-8 or flagged dead by the PPE).
    """
    rows = {row["name"]: row for row in point["per_parameter"]}
    lines: dict[int, list[str]] = {}
    for gate in circuit.gates:
        if gate.source_line is None:
            continue
        bucket = lines.setdefault(gate.source_line, [])
        bucket.extend(
            a.name for a in gate.angles if isinstance(a, ParamRef) and a.name in rows and a.name not in bucket
        )
    entries = []
    for line, names in sorted(lines.items()):
        if not names:
            continue
        known = [float(rows[name]["variance"]) for name in names if rows[name]["variance"] is not None]
        unknown = len(known) < len(names)  # a stopped run: no value, never a guessed one
        dead = not unknown and all(rows[name]["dead"] or rows[name]["variance"] < DEAD_VARIANCE for name in names)
        entries.append({
            "line": line, "parameters": list(names), "variance": (sum(known) / len(known)) if known and not unknown else None,
            "dead": dead,
        })
    dead_count = sum(1 for e in entries if e["dead"])
    exact = point["method"] == "pauli_propagation_exact"
    return {
        "method": "pauli_propagation_exact" if exact else "pauli_propagation_bounded",
        "objective": observable_text, "n_qubits": circuit.n_qubits, "lines": entries,
        "dead_fraction": (dead_count / len(entries)) if entries else 0.0,
    }
