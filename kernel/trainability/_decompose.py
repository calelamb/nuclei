"""Bounded decomposition of composite blocks before IR conversion (PRD 15 R-5).

Library circuits (``EfficientSU2``, ``TwoLocal``, ``ZZFeatureMap``, ``QFT``, ``PauliEvolutionGate``)
and user-defined sub-circuit blocks reach the converter as ONE instruction whose name no gate table
knows. Rather than teach the tables every block, a composite instruction is expanded through its own
definition, at most :data:`MAX_DECOMPOSE_LEVELS` levels deep, until every leaf is a gate the converter
already lowers. Only *composite* instructions are expanded: a standard gate the IR does not support
(``ecr``), a numeric matrix (``unitary``) and an opaque gate stay ``unsupported_gate`` and are named.

All leaves of one composite share the composite's ``source_index`` (and so its ``source_line``), the
same convention the converters already use for ``U`` and ``CXPowGate``.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Iterator

from kernel.trainability.ir import IrError

__all__ = [
    "DECOMPOSE_ENV",
    "MAX_DECOMPOSE_LEVELS",
    "DecompositionLog",
    "cirq_decompose_once",
    "decompose_enabled",
    "is_composite_cirq",
    "is_composite_qiskit",
    "pauli_evolution_note",
    "qiskit_leaves",
]

MAX_DECOMPOSE_LEVELS = 4
# ``NUCLEI_IR_DECOMPOSE=0`` turns decomposition off for the process. The Discovery candidate sandbox sets it:
# its ``ir_conversion`` guardrail has always rejected opaque composite gates (PRD 14 exploit
# ``ss-composite-gate-cost-laundering``), and that contract must not move. The Lab leaves it on.
DECOMPOSE_ENV = "NUCLEI_IR_DECOMPOSE"

# Qiskit operations that look composite (they have a ``definition``) but are not blocks: standard gates
# the IR does not cover, numeric matrices / state preparations (synthesis would hide their cost) and
# Hamiltonian matrix exponentials.
_QISKIT_NOT_COMPOSITE_MODULES = (
    "qiskit.circuit.library.standard_gates",
    "qiskit.circuit.library.generalized_gates",
    "qiskit.circuit.library.hamiltonian_gate",
    "qiskit.circuit.library.data_preparation.state_preparation",
    "qiskit.circuit.library.data_preparation.initializer",
)
_CIRQ_COMPOSITE_NAMES = (
    "CircuitOperation", "ParallelGate", "QuantumFourierTransformGate", "PhaseGradientGate",
    "PauliStringPhasorGate", "PauliSumExponential", "ControlledGate", "SingleQubitCliffordGate", "CliffordGate",
)


def decompose_enabled(flag: bool | None = None) -> bool:
    """An explicit ``flag`` wins; otherwise decomposition is on unless ``NUCLEI_IR_DECOMPOSE=0``."""
    if flag is not None:
        return flag
    return os.environ.get(DECOMPOSE_ENV, "1").strip() != "0"


class DecompositionLog:
    """Which composites were expanded, how often and how deep (for the circuit's ``notes``)."""

    def __init__(self) -> None:
        self._seen: dict[str, tuple[int, int]] = {}

    def record(self, name: str, level: int) -> None:
        count, deepest = self._seen.get(name, (0, 0))
        self._seen[name] = (count + 1, max(deepest, level))

    def notes(self) -> list[str]:
        out = []
        for name, (count, level) in self._seen.items():
            times = f" x{count}" if count > 1 else ""
            out.append(f"decomposed composite '{name}'{times} into elementary gates (level {level})")
        return out


def too_deep(name: str) -> IrError:
    return IrError(
        "unsupported_gate",
        f"gate '{name}' needs more than {MAX_DECOMPOSE_LEVELS} decomposition levels; flatten it first",
    )


# ------------------------------------------------------------------ Qiskit


_LABEL_NOTE_CHARS = 40


def pauli_evolution_note(op: Any) -> str | None:
    """Honesty note for a ``PauliEvolutionGate`` whose synthesis only approximates ``exp(-i t H)``.

    The IR analyses the gate's own synthesized definition (default: one-rep Lie-Trotter). That is exact
    when every Pauli term commutes with every other, so no note is needed; otherwise the analysed circuit
    is a Trotterised approximation of the exact evolution (Qiskit 2.x ``Statevector`` evolves it exactly),
    and saying so is the contract. QDrift is randomised sampling and is never exact, so it is always
    noted. When commutation cannot be checked the note says that, rather than claiming either way.
    Returns ``None`` when no note is due.
    """
    if getattr(op, "name", "") != "PauliEvolution":
        return None
    synthesis = getattr(op, "synthesis", None)
    name = type(synthesis).__name__ if synthesis is not None else "LieTrotter"
    reps = getattr(synthesis, "reps", 1)
    shown = _bounded_label(getattr(op, "label", None))
    head = f"PauliEvolutionGate {shown} decomposed with {name} synthesis (reps={reps})"
    if name == "QDrift":
        return f"{head}; QDrift samples terms at random, so the analysed circuit is one random approximation of exp(-i t H)"
    operators = op.operator if isinstance(op.operator, list) else [op.operator]
    try:
        if _all_terms_commute(operators):
            return None
    except Exception:  # noqa: BLE001 - unknown structure: say so rather than claim exactness or non-commutation
        return f"{head}; commutation of its terms could not be verified, so the analysed circuit may approximate exp(-i t H)"
    return f"{head}; terms do not commute, so the analysed circuit approximates exp(-i t H)"


def _bounded_label(label: Any) -> str:
    text = str(label) if label else "PauliEvolutionGate"
    if len(text) > _LABEL_NOTE_CHARS:
        text = text[: _LABEL_NOTE_CHARS - 1] + "\u2026"
    return repr(text)


def _as_pauli_op(operator: Any):
    from qiskit.quantum_info import SparsePauliOp

    convert = getattr(SparsePauliOp, "from_sparse_observable", None)
    if convert is not None and type(operator).__name__ == "SparseObservable":
        return convert(operator)  # Pauli-only observables convert; others raise and land in "could not verify"
    return SparsePauliOp(operator)


@lru_cache(maxsize=64)
def _commute_cached(shape: tuple[int, int], x_bytes: bytes, z_bytes: bytes) -> bool:
    import numpy as np

    x = np.frombuffer(x_bytes, dtype=np.uint8).reshape(shape)
    z = np.frombuffer(z_bytes, dtype=np.uint8).reshape(shape)
    chunk = 512
    for start in range(0, shape[0], chunk):
        rows = slice(start, start + chunk)
        # symplectic product mod 2; uint8 wrap-around is mod 256, which preserves parity
        if np.any((x[rows] @ z.T + z[rows] @ x.T) % 2):
            return False
    return True


def _all_terms_commute(operators: list[Any]) -> bool:
    """Whether every Pauli term commutes with every other: one vectorised symplectic check, cached by content."""
    import numpy as np

    pauli_ops = [_as_pauli_op(o) for o in operators]
    x = np.concatenate([p.paulis.x for p in pauli_ops]).astype(np.uint8)
    z = np.concatenate([p.paulis.z for p in pauli_ops]).astype(np.uint8)
    return _commute_cached(x.shape, x.tobytes(), z.tobytes())


def is_composite_qiskit(op: Any) -> bool:
    """True for a block with a definition that is not a standard gate, matrix or state preparation."""
    if getattr(op, "_standard_gate", None) is not None:
        return False
    module = type(op).__module__ or ""
    if module.startswith(_QISKIT_NOT_COMPOSITE_MODULES):
        return False
    try:
        return getattr(op, "definition", None) is not None
    except Exception:  # noqa: BLE001 - a block whose synthesis fails is simply not decomposable
        return False


def qiskit_leaves(
    op: Any, qubits: list[int], known: frozenset[str], depth: int = 0, on_expand: Any = None
) -> Iterator[tuple[Any, list[int], int]]:
    """Yield ``(leaf_op, leaf_qubits, depth)`` for ``op``, expanding composites in time order.

    ``known`` holds the names the converter handles directly; those are never expanded.
    ``on_expand(op)`` is called for every composite expanded, at any depth (the honesty notes hang off it).
    """
    if op.name in known or not is_composite_qiskit(op):
        yield op, qubits, depth
        return
    if depth >= MAX_DECOMPOSE_LEVELS:
        raise too_deep(op.name)
    if on_expand is not None:
        on_expand(op)
    definition = op.definition
    for inner in definition.data:
        inner_qubits = [qubits[definition.find_bit(q).index] for q in inner.qubits]
        yield from qiskit_leaves(inner.operation, inner_qubits, known, depth + 1, on_expand)


# -------------------------------------------------------------------- Cirq


def is_composite_cirq(cirq: Any, op: Any) -> bool:
    names = {n for n in _CIRQ_COMPOSITE_NAMES if hasattr(cirq, n)}
    kinds = tuple(getattr(cirq, n) for n in names)
    return isinstance(op, cirq.CircuitOperation) or isinstance(op.gate, kinds)


def cirq_decompose_once(cirq: Any, op: Any) -> list[Any] | None:
    """One decomposition step (``None`` when ``op`` cannot be decomposed)."""
    out = cirq.decompose_once(op, None)
    return None if out is None else list(cirq.flatten_to_ops(out))
