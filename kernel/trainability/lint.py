"""Editor-time trainability lint (spec 5.5, rules TRN001-TRN007).

``lint(circuit, observable, *, source_lines=None, time_budget_s=0.35)`` returns
``{"diagnostics": [...], "summary": {...}}``.  Cheap structural rules always run; the DLA-based
rules (TRN002, TRN003, TRN006) need a *complete* DLA closure and are skipped, with a note in
``summary["skipped_rules"]``, if it does not finish inside its share of the time budget.  TRN004
(dead parameters) uses the exact PPE light cone / annihilation where the PPE applies and the
sound operator-support analysis of ``_deadness`` otherwise; if its time share runs out it keeps the
gates it already proved dead and reports ``summary["trn004"] == "partial"``.

Line mapping: ``source_lines`` (``source_index -> line``) wins over ``IrGate.source_line``.
``IrGate.source_index`` falls back to the gate's position when absent.
"""

from __future__ import annotations

import math
import time
from typing import Any, Mapping

from kernel.trainability import ppe_core
from kernel.trainability._circuit_walk import Rotation, source_key, walk
from kernel.trainability.ir import ParamCircuit, ParamRef
from kernel.trainability._deadness import dead_gates
from kernel.trainability.lie import lie_algebra
from kernel.trainability.pauli import PauliSum
from kernel.trainability.pauliprop import PpeNotApplicable, build_rotation_program

__all__ = ["lint", "RULES"]

DEFAULT_BUDGET_S = 0.35
_DLA_SHARE = 0.45
_PPE_DEAD_FRONTIER = 20_000

_CITES = {
    "cerezo": {"label": "Cerezo et al., Nat. Commun. 12, 1791 (2021)",
               "url": "https://doi.org/10.1038/s41467-021-21728-w"},
    "ragone": {"label": "Ragone et al., Nat. Commun. 15, 7172 (2024)",
               "url": "https://doi.org/10.1038/s41467-024-49909-3"},
    "larocca22": {"label": "Larocca et al., Quantum 6, 824 (2022)",
                  "url": "https://doi.org/10.22331/q-2022-09-29-824"},
    "goh": {"label": "Goh et al., arXiv:2308.01432 (2023)", "url": "https://arxiv.org/abs/2308.01432"},
    "larocca23": {"label": "Larocca et al., Nat. Comput. Sci. 3, 542 (2023)",
                  "url": "https://doi.org/10.1038/s43588-023-00467-6"},
}

#: (code, severity, title) - the spec's rule table.
RULES: dict[str, tuple[str, str]] = {
    "TRN001": ("warning", "Global cost function"),
    "TRN002": ("warning", "Exponentially large dynamical Lie algebra"),
    "TRN003": ("info", "Polynomial dynamical Lie algebra"),
    "TRN004": ("info", "Dead parameter"),
    "TRN005": ("info", "Redundant consecutive rotations"),
    "TRN006": ("info", "Overparameterized circuit"),
    "TRN007": ("info", "No free parameters"),
}
_EXPONENTIAL_FAMILIES = ("su", "so", "sp")
_AXIS = {"RX": "X", "RY": "Y", "RZ": "Z", "P": "Z"}


class _Ctx:
    def __init__(self, circuit: ParamCircuit, source_lines: Mapping[int, int] | None) -> None:
        self.circuit, self.source_lines = circuit, source_lines or {}

    def line(self, gate_index: int) -> int | None:
        g = self.circuit.gates[gate_index]
        key = source_key(self.circuit, gate_index)
        line = self.source_lines.get(key, g.source_line)
        return None if line is None else int(line)

    def diag(self, code: str, message: str, citation: str | None, gate_indices: list[int]) -> dict[str, Any]:
        sev, title = RULES[code]
        lines = [self.line(i) for i in gate_indices]
        first = next((ln for ln in lines if ln is not None), None)
        return {"code": code, "severity": sev, "title": title, "message": message,
                "citation": _CITES[citation] if citation else None, "line": first,
                "source_indices": [source_key(self.circuit, i) for i in gate_indices]}


# ------------------------------------------------------------------ cheap rules
def _used_parameters(circuit: ParamCircuit) -> list[str]:
    seen: dict[str, None] = {}
    for g in circuit.gates:
        for a in g.angles:
            if isinstance(a, ParamRef):
                seen.setdefault(a.name, None)
    return list(seen)


def _trn001(ctx: _Ctx, observable: PauliSum) -> list[dict]:
    n = ctx.circuit.n_qubits
    threshold = max(3, math.ceil(n / 2) + 1)
    w = observable.weight()
    if n < 4 or w < threshold:
        return []
    msg = (f"The observable has a term acting on {w} of {n} qubits (threshold {threshold}). "
           "Global costs exhibit barren plateaus even for shallow circuits; prefer local terms.")
    return [ctx.diag("TRN001", msg, "cerezo", [])]


def _trn005(ctx: _Ctx) -> list[dict]:
    last: dict[int, tuple[int, str, str]] = {}   # qubit -> (gate index, axis, param name)
    out = []
    for gi, g in enumerate(ctx.circuit.gates):
        if g.name in _AXIS and isinstance(g.angles[0], ParamRef):
            q = g.qubits[0]
            axis, name = _AXIS[g.name], g.angles[0].name
            prev = last.get(q)
            if prev and prev[1] == axis and prev[2] != name:
                msg = (f"Consecutive {axis}-axis rotations on qubit {q} with independent parameters "
                       f"{prev[2]!r} and {name!r} are redundant: they equal one rotation by the sum.")
                out.append(ctx.diag("TRN005", msg, None, [prev[0], gi]))
            last[q] = (gi, axis, name)
        else:
            for q in g.qubits:
                last.pop(q, None)
    return out


# ---------------------------------------------------------------- DLA rules
def _dla_rules(ctx: _Ctx, dla: dict, n_params: int) -> list[dict]:
    n, out = ctx.circuit.n_qubits, []
    dim, cls = dla["dimension"], dla["classification"]
    if n >= 4 and cls["family"] in _EXPONENTIAL_FAMILIES:
        msg = (f"The dynamical Lie algebra has dimension {dim} = {cls['label']} (a dimension match, not a proof): "
               "the cost is expected to concentrate exponentially with n for deep circuits.")
        out.append(ctx.diag("TRN002", msg, "ragone", []))
    if dim <= 4 * n * n and cls["family"] not in _EXPONENTIAL_FAMILIES:
        msg = (f"dim 𝔤 = {dim} ≤ 4n² = {4 * n * n}: a polynomial-dimension algebra suggests the circuit is "
               "classically simulable with 𝔤-sim when the observable or state lies in 𝔤. This does not by itself "
               "guarantee trainability: the g-purities of the observable and state still decide the variance.")
        out.append(ctx.diag("TRN003", msg, "goh", []))
    if n_params >= dim:
        msg = (f"{n_params} parameters ≥ dim 𝔤 = {dim}: the circuit is in the overparameterization regime, "
               "where optimization landscapes lose spurious minima.")
        out.append(ctx.diag("TRN006", msg, "larocca23", []))
    return out


# ------------------------------------------------------------- dead parameters
def _ppe_dead(circuit: ParamCircuit, observable: PauliSum, deadline: float) -> set[str] | None:
    try:
        prog = build_rotation_program(circuit)
    except PpeNotApplicable:
        return None
    left = deadline - time.perf_counter()
    if left <= 0.01:
        return None
    obs = [(t.coeff, t.ops) for t in observable.terms if t.ops]
    res = ppe_core.gradient_variances(prog.program, prog.n_qubits, prog.n_params, obs, min_weight_abs=0.0,
                                      max_frontier=_PPE_DEAD_FRONTIER, time_budget_s=left * 0.8)
    return {circuit.parameters[r["param"]] for r in res["per_parameter"] if r["dead"]}


def _trn004(ctx: _Ctx, observable: PauliSum, deadline: float) -> tuple[list[dict], str]:
    circuit = ctx.circuit
    items = walk(circuit)
    gate_dead, complete = dead_gates(circuit, observable, items, deadline=deadline)
    carriers: dict[str, set[int]] = {}
    for it in items:
        if isinstance(it, Rotation):
            carriers.setdefault(it.ref.name, set()).add(it.gate_index)
    ppe = _ppe_dead(circuit, observable, deadline)
    out = []
    for name, gates in carriers.items():
        by_ppe = ppe is not None and name in ppe
        if not by_ppe and not all((g, name) in gate_dead for g in gates):
            continue
        for gi in sorted(gates):
            msg = (f"Parameter {name!r} cannot affect the cost: its generator commutes with the observable "
                   "(as conjugated by the gates after it) and nothing later changes that. Remove it or move the gate.")
            out.append(ctx.diag("TRN004", msg, None, [gi]))
    return out, "complete" if complete else "partial"


# ---------------------------------------------------------------------- main
def lint(
    circuit: ParamCircuit,
    observable: PauliSum | None,
    *,
    source_lines: Mapping[int, int] | None = None,
    time_budget_s: float = DEFAULT_BUDGET_S,
) -> dict[str, Any]:
    """Run TRN001-TRN007; returns ``{"diagnostics": [...], "summary": {...}}`` (see module doc).

    ``summary`` = ``{"n_qubits", "n_parameters", "dla": {"status", "dimension"} | None,
    "observable": canonical text | None, "elapsed_ms", "skipped_rules": [...], "skipped_reason",
    "trn004": "complete"|"partial"|"skipped"}``; for a truncated DLA ``dimension`` is the lower bound.
    """
    t0 = time.perf_counter()
    deadline = t0 + float(time_budget_s)
    ctx = _Ctx(circuit, source_lines)
    n_params = len(_used_parameters(circuit))
    diags: list[dict] = []
    skipped: list[str] = []
    reason: str | None = None
    dla_summary, trn004 = None, "skipped"
    if observable is not None:
        diags += _trn001(ctx, observable)
    diags += _trn005(ctx)
    if n_params == 0:
        diags.append(ctx.diag("TRN007", "The circuit has no free parameters, so the Trainability Lab has "
                                        "nothing to analyze.", None, []))
    else:
        left = max(deadline - time.perf_counter(), 0.0)
        dla = lie_algebra(circuit, observable=observable, time_budget_s=max(left * _DLA_SHARE, 0.02))
        lower = dla["dimension"] if dla["dimension"] is not None else dla["dimension_lower_bound"]
        dla_summary = {"status": dla["status"], "dimension": lower}
        if dla["status"] == "complete":
            diags += _dla_rules(ctx, dla, n_params)
        else:
            skipped = ["TRN002", "TRN003", "TRN006"]
            reason = (f"the DLA closure did not finish ({dla['status']}: {dla['reason']}) within the "
                      f"{time_budget_s:g} s lint budget")
        if observable is not None:
            d4, trn004 = _trn004(ctx, observable, deadline)
            diags += d4
    diags.sort(key=lambda d: (d["code"], d["source_indices"]))
    return {"diagnostics": diags,
            "summary": {"n_qubits": circuit.n_qubits, "n_parameters": n_params, "dla": dla_summary,
                        "observable": observable.to_text() if observable is not None else None,
                        "elapsed_ms": int(round((time.perf_counter() - t0) * 1e3)),
                        "skipped_rules": skipped, "skipped_reason": reason, "trn004": trn004}}
