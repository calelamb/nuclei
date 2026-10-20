"""Opt-in one-level expansion of composite blocks for the circuit diagram.

The default snapshot shows ``QFT`` or ``EFFICIENTSU2`` as one box. With
``expand_blocks`` each such block is replaced by its own definition (one level,
so nested blocks stay boxes), capped so a huge ansatz cannot blow up the frame.
"""

from __future__ import annotations

from typing import Any

# Library-ish gates a diagram should keep as one box even though they have a definition.
_KEEP_AS_ONE_BOX = frozenset(
    {"unitary", "initialize", "state_preparation", "measure", "reset", "barrier", "delay", "store"}
)


def _standard_gate_names() -> frozenset[str]:
    from qiskit.circuit.library.standard_gates import get_standard_gate_name_mapping

    return frozenset(get_standard_gate_name_mapping())


def is_block(op: Any, standard_names: frozenset[str]) -> bool:
    """A composite (library circuit, ``to_gate()`` result, evolution gate)."""
    from qiskit.circuit import ControlFlowOp

    if op.name in standard_names or op.name in _KEEP_AS_ONE_BOX or isinstance(op, ControlFlowOp):
        return False
    try:
        return op.definition is not None
    except Exception:
        return False


def _body(op: Any, standard_names: frozenset[str]) -> Any:
    """The circuit a block stands for, looking through one-instruction wrappers.

    ``qc.append(QFT(3), ...)`` makes an ``Instruction`` whose whole definition
    is a single inner ``QFT`` gate; the gate structure is one wrapper deeper.
    """
    body = op.definition
    while len(body.data) == 1 and is_block(body.data[0].operation, standard_names):
        body = body.data[0].operation.definition
    return body


def expand_blocks(circuit: Any, max_gates: int) -> tuple[Any, list[str]]:
    """``(circuit_to_draw, notes)``: blocks replaced by their bodies, or the original plus a note."""
    standard = _standard_gate_names()
    bodies: dict[int, Any] = {}
    projected = 0
    for position, instruction in enumerate(circuit.data):
        if is_block(instruction.operation, standard):
            bodies[position] = _body(instruction.operation, standard)
            projected += len(bodies[position].data)
        else:
            projected += 1
        if projected > max_gates:
            return circuit, [_skipped(max_gates)]
    if not bodies:
        return circuit, []

    expanded = circuit.copy_empty_like()
    for position, instruction in enumerate(circuit.data):
        if position in bodies:
            expanded.compose(
                bodies[position],
                qubits=list(instruction.qubits),
                clbits=list(instruction.clbits),
                inplace=True,
            )
        else:
            expanded.append(instruction.operation, instruction.qubits, instruction.clbits)
    return expanded, []


def _skipped(max_gates: int) -> str:
    return (
        f"Block expansion skipped: the expanded circuit would exceed {max_gates} gates, "
        "so blocks are shown as single gates."
    )
