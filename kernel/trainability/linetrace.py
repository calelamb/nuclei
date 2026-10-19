"""Record the user-code line on which each gate was appended.

Powers addendum section C (gradient map): the converter attaches
``IrGate.source_line`` from a :class:`GateLineMap` captured while the
candidate program runs::

    with trace_gate_lines("<candidate>") as lines:
        exec(compile(code, "<candidate>", "exec"), namespace)
    circuit = from_object(namespace["qc"], line_map=lines)

Rules
-----
* Lines are 1-based and refer to the first stack frame (innermost first)
  whose ``co_filename`` equals ``filename``.
* A line that cannot be recovered is simply absent (``None``); never guessed.
  Qiskit entries carry a fingerprint (operation name and qubit indices) that
  is re-checked at lookup time, so a circuit mutated after construction
  (instructions removed or reordered) yields ``None`` instead of a wrong line.
* Qiskit: patches ``QuantumCircuit._append`` (every gate method funnels
  through it) and ``QuantumCircuit.copy`` (entries are carried to the copy).
* Cirq (best effort): patches ``GateOperation.__init__`` and records the line
  where each *operation object* was created; circuits that hold those same
  objects resolve, rebuilt operations do not.
"""

from __future__ import annotations

import sys
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

__all__ = ["GateLineMap", "trace_gate_lines"]

_Fingerprint = tuple[int, str, tuple[int, ...]]  # (line, op name, qubit indices)


@dataclass
class GateLineMap:
    """Lines recorded by :func:`trace_gate_lines`."""

    _qiskit: dict[int, dict[int, _Fingerprint]] = field(default_factory=dict)
    _cirq: dict[int, int] = field(default_factory=dict)
    _keepalive: list[Any] = field(default_factory=list)  # pins ids against reuse

    def __bool__(self) -> bool:
        return bool(self._qiskit) or bool(self._cirq)

    def qiskit_line(self, circuit: Any, index: int) -> int | None:
        """Line for ``circuit.data[index]`` or ``None`` when unknown/stale."""
        rec = self._qiskit.get(id(circuit), {}).get(index)
        if rec is None:
            return None
        line, name, qubits = rec
        try:
            inst = circuit.data[index]
            cur_name = inst.operation.name
            cur_qubits = tuple(circuit.find_bit(q).index for q in inst.qubits)
        except Exception:
            return None
        return line if (cur_name, cur_qubits) == (name, qubits) else None

    def cirq_line(self, op: Any) -> int | None:
        """Line where the Cirq operation object was created, or ``None``."""
        seen = 0
        while op is not None and seen < 8:  # unwrap TaggedOperation chains
            line = self._cirq.get(id(op))
            if line is not None:
                return line
            op = getattr(op, "sub_operation", None)
            seen += 1
        return None


# --------------------------------------------------------------- patching

_lock = threading.RLock()
_active: list[tuple[str, GateLineMap]] = []
_originals: dict[str, Any] = {}


def _user_line(filename: str) -> int | None:
    frame = sys._getframe(2)
    while frame is not None:
        if frame.f_code.co_filename == filename:
            return frame.f_lineno
        frame = frame.f_back
    return None


def _record_qiskit(circuit: Any, index: int) -> None:
    for filename, lines in _active:
        line = _user_line(filename)
        if line is None:
            continue
        try:
            inst = circuit._data[index]
            fp = (
                line,
                inst.operation.name,
                tuple(circuit.find_bit(q).index for q in inst.qubits),
            )
        except Exception:
            continue
        lines._qiskit.setdefault(id(circuit), {})[index] = fp
        lines._keepalive.append(circuit)


def _install_qiskit() -> None:
    try:
        from qiskit import QuantumCircuit
    except ImportError:
        return
    orig_append, orig_copy = QuantumCircuit._append, QuantumCircuit.copy
    _originals["qiskit"] = (QuantumCircuit, orig_append, orig_copy)

    def _append(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        index = len(self._data)
        result = orig_append(self, *args, **kwargs)
        if _active and len(self._data) > index:
            _record_qiskit(self, index)
        return result

    def copy(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        new = orig_copy(self, *args, **kwargs)
        for _, lines in _active:
            known = lines._qiskit.get(id(self))
            if known:
                lines._qiskit[id(new)] = dict(known)
                lines._keepalive.append(new)
        return new

    QuantumCircuit._append = _append
    QuantumCircuit.copy = copy


def _install_cirq() -> None:
    try:
        from cirq.ops.gate_operation import GateOperation
    except ImportError:
        return
    orig_init = GateOperation.__init__
    _originals["cirq"] = (GateOperation, orig_init)

    def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        orig_init(self, *args, **kwargs)
        for filename, lines in _active:
            line = _user_line(filename)
            if line is not None:
                lines._cirq[id(self)] = line
                lines._keepalive.append(self)

    GateOperation.__init__ = __init__


def _uninstall() -> None:
    if "qiskit" in _originals:
        cls, orig_append, orig_copy = _originals.pop("qiskit")
        cls._append, cls.copy = orig_append, orig_copy
    if "cirq" in _originals:
        cls, orig_init = _originals.pop("cirq")
        cls.__init__ = orig_init


@contextmanager
def trace_gate_lines(filename: str) -> Iterator[GateLineMap]:
    """Trace gate-append lines for code compiled with ``filename``."""
    lines = GateLineMap()
    with _lock:
        if not _active:
            _install_qiskit()
            _install_cirq()
        _active.append((filename, lines))
    try:
        yield lines
    finally:
        with _lock:
            for i, (_, mine) in enumerate(_active):
                if mine is lines:
                    del _active[i]
                    break
            if not _active:
                _uninstall()
