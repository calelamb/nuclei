"""Run Qiskit circuits on Aer without the raw-circuit pitfalls (PRD 15 R-2).

Aer only accepts its own basis, so a circuit holding ``QFT``, ``EfficientSU2``,
``PauliEvolutionGate`` or ``iswap`` died with ``unknown instruction``. Every
circuit goes through ``transpile(..., optimization_level=0)`` first (it
synthesises library blocks and translates to Aer's basis without optimising
the user's structure away). What still cannot run is reported as an
``UnsupportedInstructionError`` that names the instruction.
"""

from __future__ import annotations

import re
from typing import Any

from kernel.adapters.errors import UnsupportedInstructionError

# Operations Aer runs natively that carry no entry in `basis_gates`.
_DIRECTIVES = frozenset({"measure", "barrier", "reset", "delay", "store"})
_UNKNOWN_INSTRUCTION = re.compile(r"unknown instruction:\s*([^\s'\"]+)")
_SYNTHESIS_FAILURE = re.compile(r"name='([^']+)'")
# Operations whose result is one random trajectory rather than a fixed state.
_NON_DETERMINISTIC = frozenset({"measure", "reset", "kraus", "quantum_channel", "superop"})


def _walk(circuit):
    """Every instruction, including those inside control-flow blocks."""
    for instruction in circuit.data:
        op = instruction.operation
        yield op
        for block in getattr(op, "blocks", ()):
            yield from _walk(block)


def has_measurements(circuit) -> bool:
    return any(op.name == "measure" for op in _walk(circuit))


def is_deterministic(circuit) -> bool:
    """True when the final state is a fixed function of the circuit.

    Mid-circuit measurement, reset, noise channels and classical control make a
    state-vector run one sample of the program, so its probabilities are not
    exact. Call this on the circuit AFTER final measurements are removed.
    """
    from qiskit.circuit import ControlFlowOp

    return not any(
        op.name in _NON_DETERMINISTIC or isinstance(op, ControlFlowOp) for op in _walk(circuit)
    )


def _find_unsupported(circuit, backend) -> str | None:
    supported = set(backend.configuration().basis_gates) | _DIRECTIVES
    for op in _walk(circuit):
        if op.name in supported:
            continue
        try:
            definition = op.definition
        except Exception:
            return op.name
        if definition is None:
            return op.name
    return None


def _named_in_message(error: Exception) -> str | None:
    text = str(error)
    for pattern in (_UNKNOWN_INSTRUCTION, _SYNTHESIS_FAILURE):
        found = pattern.search(text)
        if found:
            return found.group(1)
    return None


def prepare_for_aer(circuit, backend) -> Any:
    """The circuit rewritten into Aer's basis, or an error naming the culprit."""
    from qiskit import transpile

    try:
        return transpile(circuit, backend, optimization_level=0)
    except Exception as exc:
        culprit = _find_unsupported(circuit, backend) or _named_in_message(exc)
        if culprit is None:
            raise
        raise UnsupportedInstructionError(culprit) from exc


def run_on_aer(backend, circuit, shots: int):
    """``backend.run(circuit).result()`` with Aer's unknown-instruction failure typed."""
    try:
        return backend.run(circuit, shots=shots).result()
    except Exception as exc:
        culprit = _named_in_message(exc) if "unknown instruction" in str(exc) else None
        if culprit is None:
            raise
        raise UnsupportedInstructionError(culprit) from exc
