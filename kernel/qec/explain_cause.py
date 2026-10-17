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

MAX_GUIDANCE_DECLARATIONS = 3
PREPARATION_KIND = "preparation_basis_mismatch"
MEASUREMENT_KIND = "measurement_basis_mismatch"


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
        # The blamed measurement collapses the qubit into its own basis, so it
        # *is* the effective preparation for whatever the detector compares later;
        # an earlier reset is screened off by it.
        preparation_line = line
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


def _article(basis: str) -> str:
    return "an" if basis.upper() in {"X"} else "a"


def declaration_keyword(targets: list[str]) -> str:
    """The instruction that declares these targets."""
    if targets and all(t.startswith("L") for t in targets):
        return "OBSERVABLE_INCLUDE"
    if targets and all(t.startswith("D") for t in targets):
        return "DETECTOR"
    return "DETECTOR/OBSERVABLE_INCLUDE"


def _declaration_phrase(detector_lines: dict[str, int]) -> str:
    items = list(detector_lines.items())
    shown = ", ".join(f"{t} at line {n}" for t, n in items[:MAX_GUIDANCE_DECLARATIONS])
    extra = len(items) - MAX_GUIDANCE_DECLARATIONS
    keyword = declaration_keyword([t for t, _ in items])
    if extra > 0:
        return f"the {keyword} declarations ({shown}, and {extra} more; see the list below)"
    return f"the {keyword} declaration{'s' if len(items) > 1 else ''} ({shown})"


def cause_guidance(cause: dict[str, Any]) -> str:
    """The pointing sentence: which declaration line and which preparation line to check."""
    basis = cause["basis"]
    line = cause["preparation_line"]
    keyword = declaration_keyword(list(cause["detector_lines"])) if cause["detector_lines"] else "DETECTOR"
    parts = []
    if cause["detector_lines"]:
        parts.append(_declaration_phrase(cause["detector_lines"]))
    if cause["kind"] == MEASUREMENT_KIND:
        if line is not None:
            parts.append(f"the {basis}-basis measurement at line {line}")
            tail = (
                f"the {basis}-basis measurement at line {line} leaves the qubit in {_article(basis)} "
                f"{basis} eigenstate, so the later measurements the detector compares are random"
            )
        else:
            tail = "the measurement leaves the qubit in a different basis from the later ones compared"
    else:
        if line is not None:
            parts.append(f"the preparation at line {line}")
        tail = "the qubit is prepared in the wrong basis"
    if not parts:
        return ""
    return (
        f"Check {' and '.join(parts)}: either the {keyword} compares measurements that are "
        f"not fixed in the {basis} basis, or {tail}."
    )
