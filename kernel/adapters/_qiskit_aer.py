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


def _contains_reset(op, depth: int = 0) -> bool:
    """True when `op`'s definition (recursively) resets a qubit.

    Aer's ``initialize`` is a ``reset`` followed by state preparation, so it
    collapses any entanglement its qubits carry. Plain unitary ``Gate``s cannot
    reset, which keeps this off the hot path for ordinary circuits.
    """
    from qiskit.circuit import Gate

    if op.name == "reset":
        return True
    if isinstance(op, Gate) or depth > 4:
        return False
    try:
        definition = op.definition
    except Exception:
        return False
    if definition is None:
        return False
    return any(_contains_reset(inner.operation, depth + 1) for inner in definition.data)


def is_deterministic(circuit) -> bool:
    """True when the final state is a fixed function of the circuit.

    Mid-circuit measurement, reset, noise channels and classical control make a
    state-vector run one sample of the program, so its probabilities are not
    exact. An op that resets internally (``initialize``) is exact only while
    every qubit it acts on is still untouched (a leading ``initialize`` is a
    plain state preparation; resetting half of a Bell pair is not). Call this
    on the circuit AFTER final measurements are removed.
    """
    from qiskit.circuit import ControlFlowOp

    touched: set = set()
    for instruction in circuit.data:
        op = instruction.operation
        if op.name in _NON_DETERMINISTIC or isinstance(op, ControlFlowOp):
            return False
        if op.name == "barrier":
            continue
        if _contains_reset(op) and any(q in touched for q in instruction.qubits):
            return False
        touched.update(instruction.qubits)
    return True


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


def _named_in_message(error: Exception, known: frozenset[str] | None = None) -> str | None:
    """The instruction an error message names.

    With `known` (the instruction names actually in the circuit) a candidate is
    accepted only if it is one of them: a ``name='...'`` repr can just as well
    be a register, parameter or target, and blaming that is worse than passing
    the original error through.
    """
    text = str(error)
    for pattern in (_UNKNOWN_INSTRUCTION, _SYNTHESIS_FAILURE):
        for found in pattern.finditer(text):
            candidate = found.group(1)
            if known is None or candidate in known:
                return candidate
    return None


def prepare_for_aer(circuit, backend) -> Any:
    """The circuit rewritten into Aer's basis, or an error naming the culprit."""
    from qiskit import transpile

    try:
        return transpile(circuit, backend, optimization_level=0)
    except Exception as exc:
        known = frozenset(op.name for op in _walk(circuit))
        culprit = _named_in_message(exc, known)
        if culprit is None:
            culprit = _find_unsupported(circuit, backend)
        if culprit is None:
            raise
        raise UnsupportedInstructionError(culprit) from exc


def run_on_aer(backend, circuit, shots: int):
    """``backend.run(circuit).result()`` with Aer's unknown-instruction failure typed."""
    try:
        return backend.run(circuit, shots=shots).result()
    except Exception as exc:
        known = frozenset(op.name for op in _walk(circuit))
        culprit = _named_in_message(exc, known) if "unknown instruction" in str(exc) else None
        if culprit is None:
            raise
        raise UnsupportedInstructionError(culprit) from exc
