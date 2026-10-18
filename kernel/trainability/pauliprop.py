"""IR-facing Pauli Propagation Engine (spec 5.4b).

This module connects :mod:`kernel.trainability.ppe_core` (the IR-independent math, whose
module docstring derives the doubled Markov chain, the exact variance and the rigorous
truncation intervals) to the circuit IR.

Adapter
-------
Every IR gate is lowered (see ``_circuit_walk``) to elementary items; the PPE accepts a
circuit only if each item is one of

* a **single-Pauli rotation** ``exp(-i (a v + b) c P)``: the PPE rotation
  ``exp(-i (f/2) θ P)`` with integer frequency ``f = 2 c a`` (``c`` the generator
  coefficient, ``a = ParamRef.coeff``; RX/RY/RZ have ``c = 1/2`` so ``f = a``);
* a **Clifford** gate (fixed Clifford, or a constant quarter-turn rotation);

and every parameter drives *at most one* rotation (independence).  ``U(θ, φ, λ)`` becomes
``RZ(λ), RY(θ), RZ(φ)`` (time order).  Gates with multi-Pauli generators (CRX/CRY/CRZ/CP,
sums of commuting Paulis) are rejected: their parameter has two frequencies and is in
effect shared across Pauli components.

Assumptions (stated, never hidden)
----------------------------------
Parameters are independent ``v_k ~ U[0, 2π)``.  Constant offsets are rejected because they
are "affine" parameters (the spec's fallback rule); for the *variance* an offset would be
irrelevant (``f`` integer), but ``ppe_expectation_bounds`` at fixed values needs the exact
angle, so a uniform rule is simpler.  The state is ``|0...0>``.

``ppe_expectation_bounds`` and ``ppe_frontier_curve`` evaluate a *fixed* parameter point, so
they additionally accept shared parameters (each rotation reads ``values[param]``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

import numpy as np

from kernel.trainability import ppe_core
from kernel.trainability._analysis_common import AnalysisError, observable_terms
from kernel.trainability._circuit_walk import FixedClifford, FixedOther, Rotation, walk
from kernel.trainability.ir import MAX_IR_QUBITS, ParamCircuit
from kernel.trainability.pauli import PauliSum
from kernel.trainability.ppe_core import CliffordGate, PauliRotation

__all__ = [
    "ppe_applicable",
    "ppe_gradient_variances",
    "ppe_expectation_bounds",
    "ppe_frontier_curve",
    "PpeNotApplicable",
    "build_rotation_program",
]

_OFFSET_TOL = 1e-12
_FREQ_TOL = 1e-9


class PpeNotApplicable(AnalysisError):
    """The circuit/observable/init is outside the PPE's exact class (code ``ppe_not_applicable``)."""

    def __init__(self, reason: str) -> None:
        super().__init__("ppe_not_applicable", reason)
        self.reason = reason


@dataclass(frozen=True)
class RotationProgram:
    program: tuple
    n_qubits: int
    n_params: int
    rotation_gates: tuple[tuple[int, int], ...]   # (gate_index, param_index) per rotation, time order


def _integer_freq(c: float, a: float) -> int | None:
    f = 2.0 * c * a
    r = round(f)
    return int(r) if r != 0 and abs(f - r) < _FREQ_TOL else None


def build_rotation_program(circuit: ParamCircuit, *, independent: bool = True) -> RotationProgram:
    """Lower ``circuit`` to a PPE rotation program or raise :class:`PpeNotApplicable`."""
    if circuit.n_qubits > MAX_IR_QUBITS:
        raise PpeNotApplicable(f"circuit has {circuit.n_qubits} qubits, beyond the IR limit of {MAX_IR_QUBITS}")
    index = circuit.param_index()
    program: list = []
    rot_gates: list[tuple[int, int]] = []
    users: dict[str, int] = {}
    for item in walk(circuit):
        if isinstance(item, FixedOther):
            raise PpeNotApplicable(
                f"gate {item.gate_name} (gate {item.gate_index}) is a non-Clifford fixed gate; "
                "the PPE only propagates Clifford fixed gates"
            )
        if isinstance(item, FixedClifford):
            program.extend(CliffordGate(nm, item.qubits) for nm in item.names)
            continue
        assert isinstance(item, Rotation)
        if len(item.terms) != 1:
            raise PpeNotApplicable(
                f"gate {item.gate_name} (gate {item.gate_index}) has a multi-Pauli generator "
                "(a sum of Paulis, equivalent to a shared parameter)"
            )
        if abs(item.ref.offset) > _OFFSET_TOL:
            raise PpeNotApplicable(
                f"parameter {item.ref.name!r} is affine (offset {item.ref.offset:g}); the PPE needs plain parameters"
            )
        coeff, ops = item.terms[0]
        freq = _integer_freq(coeff, item.ref.coeff)
        if freq is None:
            raise PpeNotApplicable(
                f"gate {item.gate_name} (gate {item.gate_index}) has non-integer frequency "
                f"{2.0 * coeff * item.ref.coeff:g}"
            )
        users[item.ref.name] = users.get(item.ref.name, 0) + 1
        if independent and users[item.ref.name] > 1:
            raise PpeNotApplicable(
                f"parameter {item.ref.name!r} drives more than one rotation (shared parameters break independence)"
            )
        p = index[item.ref.name]
        program.append(PauliRotation(ops, p, freq))
        rot_gates.append((item.gate_index, p))
    return RotationProgram(tuple(program), circuit.n_qubits, len(circuit.parameters), tuple(rot_gates))


def ppe_applicable(circuit: ParamCircuit, observable: PauliSum, *, init: str) -> tuple[bool, str | None]:
    """``(True, None)`` if the exact PPE variance applies, else ``(False, reason)``.

    Fails for: ``init != "uniform"`` (``small`` angles break the uniform-angle averaging),
    non-Clifford fixed gates, shared/affine parameters, multi-Pauli generators, non-integer
    frequencies, and circuits beyond ``MAX_IR_QUBITS``.
    """
    if init != "uniform":
        return False, f"init {init!r} is not uniform; the PPE averages over theta ~ U[0, 2pi)"
    if observable.max_qubit() >= circuit.n_qubits:
        return False, "the observable touches qubits outside the circuit"
    try:
        build_rotation_program(circuit)
    except PpeNotApplicable as exc:
        return False, exc.reason
    return True, None


def _require(circuit: ParamCircuit, observable: PauliSum, *, independent: bool) -> RotationProgram:
    if observable.max_qubit() >= circuit.n_qubits:
        raise AnalysisError("invalid_observable", "the observable touches qubits outside the circuit")
    return build_rotation_program(circuit, independent=independent)


def ppe_gradient_variances(
    circuit: ParamCircuit,
    observable: PauliSum,
    *,
    max_weight: int | None = None,
    min_weight_abs: float = 1e-12,
    max_frontier: int = 2_000_000,
    time_budget_s: float = 20.0,
    progress: Callable[[float, str], None] | None = None,
    cancel: Callable[[], bool] | None = None,
) -> dict:
    """Exact ``Var[dC/dv_k]`` for every parameter, under ``v ~ U[0, 2π)`` (see ``ppe_core``).

    Returns ``{"method", "per_parameter": [{"name", "variance", "interval": [lo, hi], "dead",
    "dead_reason"}], "variance_mean", "variance_mean_interval", "frontier_peak",
    "discarded_mass", "elapsed_ms", "status", "cost_mean", "cost_variance" (None unless informative),
    "cost_variance_interval"}`` with parameter *names* in
    ``circuit.parameters`` order.  Intervals are rigorous.  Raises :class:`PpeNotApplicable`.
    """
    prog = _require(circuit, observable, independent=True)
    res = ppe_core.gradient_variances(
        prog.program, prog.n_qubits, prog.n_params, observable_terms(observable, drop_identity=True),
        max_weight=max_weight, min_weight_abs=min_weight_abs, max_frontier=max_frontier,
        time_budget_s=time_budget_s, progress=progress, cancel=cancel,
    )
    rows = [
        {"name": circuit.parameters[r["param"]], "variance": r["variance"], "interval": list(r["interval"]),
         "dead": r["dead"], "dead_reason": r["dead_reason"]}
        for r in res["per_parameter"]
    ]
    identity = sum(float(t.coeff) for t in observable.terms if not t.ops)
    return {**{k: v for k, v in res.items() if k != "per_parameter"}, "per_parameter": rows,
            "cost_mean": res["cost_mean"] + identity}


def ppe_expectation_bounds(
    circuit: ParamCircuit, observable: PauliSum, values: Sequence[float] | np.ndarray, **budget
) -> dict:
    """``<O>`` at fixed ``values`` (``circuit.parameters`` order) with a rigorous interval.

    ``budget`` keys: ``max_weight, min_weight_abs, max_frontier, time_budget_s, cancel``.
    Returns ``{"value", "interval", "frontier_peak", "discarded_mass", "method", "status",
    "elapsed_ms"}``.  Shared parameters are allowed here (see module docstring).
    """
    vec = np.asarray(values, dtype=float).reshape(-1)
    if vec.shape[0] != len(circuit.parameters):
        raise AnalysisError("invalid_values", f"expected {len(circuit.parameters)} values, got {vec.shape[0]}")
    prog = _require(circuit, observable, independent=False)
    return ppe_core.expectation_bounds(
        prog.program, prog.n_qubits, observable_terms(observable), vec, **budget
    )


def ppe_frontier_curve(
    circuit: ParamCircuit, observable: PauliSum, values: Sequence[float] | np.ndarray, *,
    frontier_sizes: Sequence[int], **budget
) -> list[dict]:
    """Interval width of ``<O>`` versus ``max_frontier`` (the estimation-hardness probe)."""
    vec = np.asarray(values, dtype=float).reshape(-1)
    if vec.shape[0] != len(circuit.parameters):
        raise AnalysisError("invalid_values", f"expected {len(circuit.parameters)} values, got {vec.shape[0]}")
    prog = _require(circuit, observable, independent=False)
    return ppe_core.frontier_curve(
        prog.program, prog.n_qubits, observable_terms(observable), vec, frontier_sizes=frontier_sizes, **budget
    )

