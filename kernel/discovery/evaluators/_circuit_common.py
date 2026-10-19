"""Helpers shared by the two ``quantum_circuit`` evaluators.

* Artifact -> :class:`ParamCircuit` re-parsing (the trusted scorer never trusts
  the sandbox's IR; it validates it again with ``ParamCircuit.from_json``).
* The guardrails both evaluators share (``ir_conversion``, ``qubit_count``,
  ``parameter_budget``).
* Canonical cost (spec 4.1.6) of an IR circuit via :mod:`kernel.discovery.cost`.
* A small seeded, batched Adam optimizer.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field, replace
from typing import Any, Callable

import numpy as np

from kernel.discovery.cost import two_qubit_cost, total_depth
from kernel.discovery.evaluators.guardrails import FAIL, PASS, CheckResult
from kernel.trainability.ir import IrError, ParamCircuit, ParamRef

TWO_PI = 2.0 * math.pi
#: Gates whose canonical Clifford+T form needs 7 T gates (standard Toffoli/Fredkin decomposition).
_T_HEAVY = {"CCX": 7, "CCZ": 7, "CSWAP": 7}
_T_LIKE = {"T", "TDG"}
_ROTATIONS = {"RX", "RY", "RZ", "P"}
_NON_ARTIFACT = "The sandbox did not return a circuit artifact."


@dataclass
class CircuitHolder:
    """Mutable slot a guardrail fills so later guardrails and scoring can reuse the parse."""

    circuit: ParamCircuit | None = None
    extras: dict[str, Any] = field(default_factory=dict)


def ir_conversion_check(holder: CircuitHolder, artifact: Any) -> CheckResult:
    """Guardrail ``ir_conversion``: the artifact must hold a valid IR of elementary gates."""
    if not isinstance(artifact, dict):
        return FAIL, _NON_ARTIFACT
    error = artifact.get("ir_error")
    if isinstance(error, dict):
        return FAIL, f"{error.get('code', 'conversion_failed')}: {error.get('message', 'conversion failed')}"[:600]
    try:
        holder.circuit = ParamCircuit.from_json(artifact.get("ir"))
    except IrError as exc:
        return FAIL, f"{exc.code}: {exc.message}"[:600]
    return PASS, None


def qubit_count_check(holder: CircuitHolder, expected: int) -> CheckResult:
    circuit = holder.circuit
    if circuit is None or circuit.n_qubits != expected:
        got = None if circuit is None else circuit.n_qubits
        return FAIL, f"Expected exactly {expected} qubits, the circuit uses {got}."
    return PASS, None


def parameter_budget_check(holder: CircuitHolder, limit: int, *, label: str = "free parameters") -> CheckResult:
    count = len(holder.circuit.parameters) if holder.circuit else 0
    if count > limit:
        return FAIL, f"{count} {label} exceeds the budget of {limit}."
    return PASS, None


#: A fixed angle within this (radians) of a multiple of pi/2 is a Clifford rotation (free). 1e-6 forgives
#: constants printed to six digits (3.141593); an offset that small carries no hidden information.
CLIFFORD_ANGLE_TOLERANCE = 1e-6
_HALF_PI = math.pi / 2


def _is_multiple_of(angle: float, unit: float) -> bool:
    ratio = float(angle) / unit
    return abs(ratio - round(ratio)) * unit < CLIFFORD_ANGLE_TOLERANCE


def _fixed_angle_is_charged(angle: float) -> bool:
    """A hard-coded angle costs a parameter unless it is Clifford (k*pi/2) or T-like (odd k*pi/4).

    Clifford angles carry no continuous information. Odd multiples of pi/4 are the Clifford+T
    alphabet: a finite set (about 2 bits per gate) that cannot hide a pre-trained continuous
    value, and ``t_count`` already prices them in ``costs``. Any other constant (0.734, ...) is a
    continuous value the candidate chose offline instead of letting the evaluator train it.
    """
    return not (_is_multiple_of(angle, _HALF_PI) or _is_multiple_of(angle, math.pi / 4))


def _shared_use_is_charged(ref: ParamRef) -> bool:
    """A 2nd+ use of one free parameter smuggles a fixed offset/ratio unless both are Clifford-clean.

    ``RY(t + 0.7)`` next to ``RY(t)`` encodes the pre-trained gap 0.7 in constants. Integer
    coefficients (``RZ(2t)``) and offsets that are multiples of pi/2 are legitimate tying.
    """
    integer_coeff = abs(ref.coeff - round(ref.coeff)) < CLIFFORD_ANGLE_TOLERANCE
    return not (integer_coeff and _is_multiple_of(ref.offset, _HALF_PI))


def effective_parameter_counts(circuit: ParamCircuit) -> dict[str, int]:
    """Free parameters plus the constants that behave like trained parameters.

    ``effective_parameters = n_free_parameters + n_fixed_nonclifford_angles`` where the second term
    counts (a) hard-coded gate angles that are neither Clifford nor T-like and (b) every use of a
    free parameter after its first whose offset/coefficient is not a clean Clifford tying.
    This closes parameter laundering: pre-training angles offline and hard-coding them.
    """
    seen: set[str] = set()
    fixed = 0
    for gate in circuit.gates:
        for angle in gate.angles:
            if isinstance(angle, ParamRef):
                if angle.name in seen and _shared_use_is_charged(angle):
                    fixed += 1
                seen.add(angle.name)
            elif _fixed_angle_is_charged(angle):
                fixed += 1
    free = len(circuit.parameters)
    return {"n_free_parameters": free, "n_fixed_nonclifford_angles": fixed, "effective_parameters": free + fixed}


def promote_fixed_angles(circuit: ParamCircuit) -> ParamCircuit:
    """The same circuit with every charged hard-coded angle turned into a fresh free parameter.

    ``vqe_ground_state`` measures an *ansatz* trained under the evaluator's own budget. A charged
    constant is a pre-trained parameter, so the evaluator trains it like any other (from its own
    initialization, ignoring the candidate's value): offline optimization cannot beat the training
    budget, and ``len(result.parameters) == effective_parameters`` by construction.
    """
    taken = set(circuit.parameters)
    added: list[str] = []

    def fresh() -> ParamRef:
        name = f"fixed_{len(added)}"
        while name in taken:
            name = f"_{name}"
        taken.add(name)
        added.append(name)
        return ParamRef(name)

    seen: set[str] = set()
    gates = []
    for gate in circuit.gates:
        angles = []
        for angle in gate.angles:
            if isinstance(angle, ParamRef):
                charged = angle.name in seen and _shared_use_is_charged(angle)
                seen.add(angle.name)
                angles.append(fresh() if charged else angle)
            else:
                angles.append(fresh() if _fixed_angle_is_charged(angle) else angle)
        gates.append(replace(gate, angles=tuple(angles)))
    return ParamCircuit(
        n_qubits=circuit.n_qubits, gates=gates, parameters=[*circuit.parameters, *added],
        framework=circuit.framework, notes=list(circuit.notes),
    )


def dropped_measurements(circuit: ParamCircuit) -> str | None:
    """The converter's ``dropped N measurement(s)`` note, if any."""
    for note in circuit.notes:
        if note.startswith("dropped ") and "measurement" in note:
            return note
    return None


def gate_tuples(circuit: ParamCircuit) -> list[tuple[str, tuple[int, ...]]]:
    return [(g.name, g.qubits) for g in circuit.gates]


def _is_odd_quarter_turn(angle: Any) -> bool:
    if isinstance(angle, ParamRef):
        return False
    quarter = float(angle) / (math.pi / 4)
    nearest = round(quarter)
    return abs(quarter - nearest) < 1e-9 and nearest % 2 != 0


def t_count(circuit: ParamCircuit) -> int:
    """Number of T-type gates after canonical decomposition.

    ``T``/``TDG`` count 1, ``CCX``/``CCZ``/``CSWAP`` count 7, and a fixed
    ``RZ``/``P`` at an odd multiple of pi/4 counts 1. Continuous or
    parameterized rotations are NOT counted (they have no finite T cost);
    they are reported separately as ``continuous_rotations``.
    """
    total = 0
    for gate in circuit.gates:
        if gate.name in _T_LIKE:
            total += 1
        elif gate.name in _T_HEAVY:
            total += _T_HEAVY[gate.name]
        elif gate.name in ("RZ", "P") and _is_odd_quarter_turn(gate.angles[0]):
            total += 1
    return total


def continuous_rotations(circuit: ParamCircuit) -> int:
    return sum(
        1 for g in circuit.gates
        if g.name in _ROTATIONS and (isinstance(g.angles[0], ParamRef) or not _is_odd_quarter_turn(g.angles[0]))
    )


def circuit_costs(circuit: ParamCircuit) -> dict[str, int]:
    """Canonical-decomposition costs (spec 4.1.6)."""
    gates = gate_tuples(circuit)
    return {
        "two_qubit_gates": int(two_qubit_cost(gates)),
        "depth": int(total_depth(gates)),
        "t_count": int(t_count(circuit)),
    }


# --- optimization -------------------------------------------------------------


def initial_parameters(rng: np.random.Generator, restarts: int, m: int, init: str) -> np.ndarray:
    """``uniform``: theta ~ U[0, 2pi); ``small``: theta ~ N(0, 0.1^2). Shape (restarts, m)."""
    if init == "small":
        return rng.normal(0.0, 0.1, (restarts, m))
    return rng.uniform(0.0, TWO_PI, (restarts, m))


def adam_minimize(
    objective: Callable[[np.ndarray], tuple[np.ndarray, np.ndarray]],
    theta0: np.ndarray,
    *,
    steps: int,
    learning_rate: float,
    cancel: threading.Event | None = None,
    progress: Callable[[float, str], None] | None = None,
    label: str = "optimizing",
) -> dict[str, np.ndarray]:
    """Batched Adam (rows are independent restarts) minimizing ``objective``.

    ``objective(theta (R, m)) -> (values (R,), grads (R, m))``. Every evaluated
    point is exact, so the best value seen is an honest achieved value.
    Returns ``best_value (R,)``, ``best_theta (R, m)`` and ``history (steps+1, R)``.
    """
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    theta = np.array(theta0, dtype=np.float64)
    first = np.zeros_like(theta)
    second = np.zeros_like(theta)
    best_value = np.full(theta.shape[0], np.inf)
    best_theta = theta.copy()
    history: list[np.ndarray] = []
    for step in range(steps + 1):
        if cancel is not None and cancel.is_set():
            raise InterruptedError("cancelled")
        values, grads = objective(theta)
        values = np.asarray(values, dtype=np.float64)
        history.append(values)
        improved = values < best_value
        best_value = np.where(improved, values, best_value)
        best_theta = np.where(improved[:, None], theta, best_theta)
        if step == steps:
            break
        first = beta1 * first + (1 - beta1) * grads
        second = beta2 * second + (1 - beta2) * grads * grads
        corrected_first = first / (1 - beta1 ** (step + 1))
        corrected_second = second / (1 - beta2 ** (step + 1))
        theta = theta - learning_rate * corrected_first / (np.sqrt(corrected_second) + eps)
        if progress is not None and step % 10 == 0:
            progress(step / max(steps, 1), label)
    return {"best_value": best_value, "best_theta": best_theta, "history": np.stack(history)}


def thin_curve(values: np.ndarray, limit: int = 50) -> list[float]:
    """At most ``limit`` evenly spaced points that always include the first and last."""
    count = len(values)
    if count <= limit:
        return [float(v) for v in values]
    picks = np.unique(np.linspace(0, count - 1, limit).round().astype(int))
    return [float(values[i]) for i in picks]
