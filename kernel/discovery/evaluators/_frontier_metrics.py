"""Algebra probe, interaction structure and the PPE gradient map for ``trainability_frontier``."""

from __future__ import annotations

import math
from typing import Any

from kernel.trainability.ir import ParamCircuit, ParamRef
from kernel.trainability.lie import lie_algebra

DEAD_VARIANCE = 1e-8
DLA_MAX_DIMENSION = 4096
DLA_TIME_BUDGET_S = 10.0
ALGEBRA_FACTOR = 2


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
        "threshold": ALGEBRA_FACTOR * circuit.n_qubits,
    }


def interaction_blocks(circuit: ParamCircuit) -> list[list[int]]:
    """Connected components of the qubit graph whose edges are the multi-qubit gates.

    More than one block means the circuit is a tensor product of independent sub-circuits:
    its algebra is a direct sum and it is classically simulable block by block.
    """
    parent = list(range(circuit.n_qubits))

    def find(q: int) -> int:
        while parent[q] != q:
            parent[q] = parent[parent[q]]
            q = parent[q]
        return q

    for gate in circuit.gates:
        for other in gate.qubits[1:]:
            parent[find(other)] = find(gate.qubits[0])
    groups: dict[int, list[int]] = {}
    for q in range(circuit.n_qubits):
        groups.setdefault(find(q), []).append(q)
    return sorted(groups.values())


def algebra_verdict(circuit: ParamCircuit, probe: dict[str, Any]) -> tuple[bool, str]:
    """``(ok, detail)`` for ``nontrivial_algebra``: dimension > 2n and no product structure."""
    n = circuit.n_qubits
    bound = probe["dimension_lower_bound"] or 0
    label = probe["classification"]["label"]
    blocks = interaction_blocks(circuit)
    reached = "" if probe["status"] == "complete" else " (closure incomplete, lower bound)"
    if bound <= ALGEBRA_FACTOR * n:
        return False, (
            f"At n={n} the dynamical Lie algebra has dimension {bound}{reached} <= 2n={2 * n} "
            f"(classification: {label}); product and near-free ansatzes are trivially trainable "
            "and trivially simulable."
        )
    if len(blocks) > 1:
        return False, (
            f"At n={n} the entangling gates split the qubits into {len(blocks)} independent blocks, "
            f"so the circuit is a tensor product (algebra dimension {bound}{reached}, classification: "
            f"{label}); it is trivially simulable block by block."
        )
    return True, f"DLA dimension {bound}{reached} > 2n={2 * n} (classification: {label})."


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
        variances = [float(rows[name]["variance"]) for name in names]
        dead = all(rows[name]["dead"] or rows[name]["variance"] < DEAD_VARIANCE for name in names)
        entries.append({
            "line": line, "parameters": list(names), "variance": sum(variances) / len(variances), "dead": dead,
        })
    dead_count = sum(1 for e in entries if e["dead"])
    exact = point["method"] == "pauli_propagation_exact"
    return {
        "method": "pauli_propagation_exact" if exact else "pauli_propagation_bounded",
        "objective": observable_text, "n_qubits": circuit.n_qubits, "lines": entries,
        "dead_fraction": (dead_count / len(entries)) if entries else 0.0,
    }
