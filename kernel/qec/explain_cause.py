"""Name the real cause when Stim blames a reset/measurement for basis non-determinism.

Stim reports the collapse (a reset or measurement) where a detector's tracked
Pauli anti-commutes with it. That is where Stim *noticed* the problem, not what
is wrong: the detector's parity is simply not fixed by the preparation in that
basis (e.g. an X-type detector in round 0 of a Z-basis memory experiment). The
fix is usually in the DETECTOR declaration or the preparation line.
"""

from __future__ import annotations

from typing import Any

from kernel.qec.explain_parse import StimAnalysisError, split_basis_operation

PREPARATION_GATES = frozenset({"R", "RX", "RY", "RZ", "MR", "MRX", "MRY", "MRZ"})
PREPARATION_KIND = "preparation_basis_mismatch"
MEASUREMENT_KIND = "measurement_basis_mismatch"


def _previous_preparation_line(source: str, line: int | None, qubit: int | None) -> int | None:
    """Nearest earlier line that resets ``qubit`` (textual scan; best effort)."""
    if line is None or qubit is None:
        return None
    rows = source.splitlines()
    for number in range(min(line, len(rows)) - 1, 0, -1):
        tokens = rows[number - 1].split("#", 1)[0].split()
        if not tokens or tokens[0].split("(", 1)[0].upper() not in PREPARATION_GATES:
            continue
        if str(qubit) in tokens[1:]:
            return number
    return None


def classify_cause(
    info: StimAnalysisError, source: str, line: int | None, declared: dict[str, int]
) -> dict[str, Any] | None:
    """Structured cause for a basis mismatch, or None when the cause is not a basis one."""
    split = split_basis_operation(info.operation)
    if split is None:
        return None
    basis, rest = split
    if "reset" in rest and "measurement" not in rest:
        preparation_line = line
        kind = PREPARATION_KIND
    elif "measurement" in rest:
        qubit = info.qubits[0] if info.qubits else None
        preparation_line = _previous_preparation_line(source, line, qubit)
        kind = MEASUREMENT_KIND
    else:
        return None
    return {
        "kind": kind,
        "basis": basis,
        "operation_line": line,
        "preparation_line": preparation_line,
        "detector_lines": dict(declared),
    }


def cause_guidance(cause: dict[str, Any]) -> str:
    """The pointing sentence: which DETECTOR line and which preparation line to check."""
    detectors = ", ".join(f"{t} at line {n}" for t, n in cause["detector_lines"].items())
    prep = cause["preparation_line"]
    parts = []
    if detectors:
        parts.append(f"the DETECTOR declaration ({detectors})")
    if prep is not None:
        parts.append(f"the preparation at line {prep}")
    if not parts:
        return ""
    return (
        f"Check {' and '.join(parts)}: either the DETECTOR compares measurements that are "
        f"not fixed in the {cause['basis']} basis, or the qubit is prepared in the wrong basis."
    )
