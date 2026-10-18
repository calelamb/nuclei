"""``state_synthesis`` — prepare a target state with few expensive gates (PRD 14 spec 6.3).

Parameter laundering (hard-coding pre-trained angles to dodge a parameter count) does not apply
here by design: the objective is the canonical *gate* cost (two-qubit gates, depth or T-count), and
the number of free parameters is never rewarded or scored. A fixed rotation is a legitimate gate
and is already charged by that gate cost, and the free parameters the evaluator trains cost the
same gates. ``metrics.n_fixed_nonclifford_angles`` is reported for transparency only.

The candidate's ``build(n_qubits)`` returns a Qiskit/Cirq circuit. The sandbox
converts it to IR; this trusted scorer re-validates the IR, runs the five
guardrails in order, and computes every number itself.

Design decisions (documented because the spec leaves them open)
----------------------------------------------------------------
* ``no_measurement``: the converter drops *trailing* measurements and records a
  ``dropped N measurement(s)`` note. A state-preparation circuit has no business
  measuring, so that note is a FAIL here. A gate acting after a measurement is
  rejected earlier by ``ir_conversion`` (``mid_circuit_measurement``).
* Fidelity gradient: ``F = |<t|psi>|^2`` is a rank-one projector expectation, so
  we reuse the compiler's adjoint sweep with co-state ``<t|psi> |t>``
  (``_fidelity.py``), verified against finite differences.
* ``gradient_map`` (only when the circuit has parameters): variance of the
  gradient of the *scaled fidelity* ``2^n * F`` at random theta. F itself is
  ~2^-n at random theta, so its raw gradient variance would trip the fixed
  1e-8 "dead" threshold at larger n for the wrong reason; scaling by 2^n makes
  the threshold n-independent. The map is labelled ``objective:
  "scaled_fidelity"``. We do NOT use a local-Z proxy: a final RZ is dead for
  Z-observables but essential for state preparation.
* Cost is read from the canonical decomposition (spec 4.1.6) in ``cost.py``.
"""

from __future__ import annotations

import threading
from typing import Any, Callable

import numpy as np

from kernel.discovery.evaluators._circuit_common import (
    CircuitHolder,
    adam_minimize,
    circuit_costs,
    continuous_rotations,
    effective_parameter_counts,
    dropped_measurements,
    initial_parameters,
    ir_conversion_check,
    parameter_budget_check,
    qubit_count_check,
)
from kernel.discovery.evaluators._fidelity import fidelity_from_states, fidelity_value_and_grad
from kernel.discovery.evaluators.base import EvaluationCore, EvaluatorSpec
from kernel.discovery.evaluators.guardrails import FAIL, PASS, Guardrail, run_guardrails
from kernel.discovery.gradient_map import gradient_map
from kernel.discovery.targets import KINDS as TARGET_KINDS
from kernel.discovery.targets import TargetError, target_state
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit

KIND = "state_synthesis"
VERSION = "1.0.0"
MAX_PARAMETERS = 128
GRADIENT_MAP_SAMPLES = 32
COST_KINDS = ("two_qubit_gates", "depth", "t_count")

DEFAULT_ALLOWED_GATES = ["H", "X", "Y", "Z", "S", "SDG", "T", "TDG", "SX", "RX", "RY", "RZ", "CX", "CZ"]

DEFAULT_CONFIG: dict[str, Any] = {
    "target": {"kind": "w", "n_qubits": 5},
    "fidelity_threshold": 0.999,
    "cost": "two_qubit_gates",
    "cost_weight": 0.1,
    "allowed_gates": DEFAULT_ALLOWED_GATES,
    "optimize_parameters": {"restarts": 8, "steps": 300, "learning_rate": 0.05},
}

CONFIG_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "target": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "kind": {"enum": list(TARGET_KINDS)},
                "n_qubits": {"type": "integer", "minimum": 2, "maximum": 12},
                "k": {"type": "integer", "minimum": 0, "maximum": 12},
                "seed": {"type": "integer", "minimum": 0},
            },
        },
        "fidelity_threshold": {"type": "number", "minimum": 0.5, "maximum": 1},
        "cost": {"enum": list(COST_KINDS)},
        "cost_weight": {"type": "number", "minimum": 0, "maximum": 10},
        "allowed_gates": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
        "optimize_parameters": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "restarts": {"type": "integer", "minimum": 1, "maximum": 32},
                "steps": {"type": "integer", "minimum": 1, "maximum": 2000},
                "learning_rate": {"type": "number", "minimum": 1e-4, "maximum": 1},
            },
        },
    },
}

STAGES: dict[str, dict[str, Any]] = {
    "screen": {"optimize_parameters": {"restarts": 1, "steps": 60}},
    "full": {},
    "confirm": {},
}


def validate_extra(config: dict[str, Any]) -> str | None:
    target = config["target"]
    if target["kind"] == "dicke" and target.get("k", target["n_qubits"] // 2) > target["n_qubits"]:
        return "target.k must not exceed target.n_qubits"
    return None


def calls(config: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"args": [config["target"]["n_qubits"]], "kwargs": {}}]


def _gate_set_check(holder: CircuitHolder, allowed: list[str]) -> tuple[str, str | None]:
    circuit = holder.circuit
    names = sorted({g.name for g in circuit.gates} - set(allowed)) if circuit else []
    if names:
        return FAIL, f"Gate(s) not in the allowed set: {', '.join(names)}."
    return PASS, None


def _no_measurement_check(holder: CircuitHolder) -> tuple[str, str | None]:
    note = dropped_measurements(holder.circuit) if holder.circuit else None
    if note:
        return FAIL, f"State preparation must not measure ({note})."
    return PASS, None


def _guardrails(holder: CircuitHolder, artifact: Any, config: dict[str, Any]) -> list[Guardrail]:
    n = config["target"]["n_qubits"]
    return [
        Guardrail("ir_conversion", "Circuit converts to elementary gates", lambda: ir_conversion_check(holder, artifact)),
        Guardrail("gate_set", "Only allowed gates", lambda: _gate_set_check(holder, config["allowed_gates"])),
        Guardrail("qubit_count", f"Exactly {n} qubits", lambda: qubit_count_check(holder, n)),
        Guardrail("no_measurement", "No measurements", lambda: _no_measurement_check(holder)),
        Guardrail(
            "parameter_budget", f"At most {MAX_PARAMETERS} free parameters",
            lambda: parameter_budget_check(holder, MAX_PARAMETERS),
        ),
    ]


def _best_fidelity(
    circuit: ParamCircuit, target: np.ndarray, config: dict[str, Any], seed: int,
    progress: Callable[[float, str], None] | None, cancel: threading.Event | None,
) -> dict[str, Any]:
    """Fidelity of the circuit, optimizing free parameters with seeded Adam restarts."""
    program = compile_circuit(circuit)
    m = len(circuit.parameters)
    if m == 0:
        fidelity = float(fidelity_from_states(program.states(np.zeros((1, 0))), target)[0])
        return {"fidelity": fidelity, "restart_fidelities": [fidelity], "optimized": False, "steps": 0}
    opt = config["optimize_parameters"]
    theta0 = initial_parameters(np.random.default_rng(seed), opt["restarts"], m, "uniform")

    def negative_fidelity(theta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        value, grad = fidelity_value_and_grad(program, theta, target)
        return -value, -grad

    result = adam_minimize(
        negative_fidelity, theta0, steps=opt["steps"], learning_rate=opt["learning_rate"],
        cancel=cancel, progress=progress, label="optimizing fidelity",
    )
    # Re-measure the winners through states() so F never depends on the adjoint path.
    checked = fidelity_from_states(program.states(result["best_theta"]), target)
    return {
        "fidelity": float(np.max(checked)),
        "restart_fidelities": [float(x) for x in checked],
        "optimized": True,
        "steps": opt["steps"],
        "best_theta": [float(x) for x in result["best_theta"][int(np.argmax(checked))]],
    }


def _scaled_fidelity_gradient(circuit: ParamCircuit, target: np.ndarray):
    program = compile_circuit(circuit)
    scale = float(1 << circuit.n_qubits)

    def grads(thetas: np.ndarray) -> np.ndarray:
        return scale * fidelity_value_and_grad(program, thetas, target)[1]

    return grads


def score(
    config: dict[str, Any],
    artifacts: list[dict[str, Any]],
    seed: int,
    progress: Callable[[float, str], None] | None = None,
    cancel: threading.Event | None = None,
    stage: str = "full",
    cache_dir: str | None = None,
) -> EvaluationCore:
    artifact = next((a["artifact"] for a in artifacts if a.get("call_index") == 0), None)
    holder = CircuitHolder()
    records, rejection = run_guardrails(_guardrails(holder, artifact, config))
    if rejection is not None:
        return EvaluationCore(status="rejected", guardrails=records, rejection=rejection)
    circuit = holder.circuit
    assert circuit is not None
    try:
        target = target_state(config["target"])
    except TargetError as exc:
        return EvaluationCore(
            status="failed", guardrails=records,
            failure={"stage": "score", "code": "invalid_target", "message": str(exc)},
        )
    try:
        outcome = _best_fidelity(circuit, target, config, seed, progress, cancel)
    except IrError as exc:
        return EvaluationCore(
            status="failed", guardrails=records,
            failure={"stage": "score", "code": exc.code, "message": exc.message},
        )
    return _scored(circuit, target, outcome, config, seed, records)


def _scored(
    circuit: ParamCircuit, target: np.ndarray, outcome: dict[str, Any], config: dict[str, Any],
    seed: int, records: list[dict[str, Any]],
) -> EvaluationCore:
    fidelity = min(max(outcome["fidelity"], 0.0), 1.0)
    costs = circuit_costs(circuit)
    cost_kind = config["cost"]
    threshold = config["fidelity_threshold"]
    fitness = 10.0 * min(fidelity / threshold, 1.0) - config["cost_weight"] * costs[cost_kind]
    metrics: dict[str, Any] = {
        "fidelity": fidelity,
        "fidelity_threshold": threshold,
        "meets_threshold": fidelity >= threshold,
        "restart_fidelities": outcome["restart_fidelities"],
        "optimized": outcome["optimized"],
        "n_parameters": len(circuit.parameters),
        "cost_kind": cost_kind,
        "costs": costs,
        "continuous_rotations": continuous_rotations(circuit),
        # Informational only: unlike vqe_ground_state this cost is gates, not parameters, so a hard-coded
        # angle is already charged as the gate it is and is NOT an extra penalty (see module docstring).
        "n_fixed_nonclifford_angles": effective_parameter_counts(circuit)["n_fixed_nonclifford_angles"],
        "best_theta": list(outcome.get("best_theta", [])),
        "parameter_names": list(circuit.parameters),
    }
    if circuit.parameters:
        metrics["gradient_map"] = gradient_map(
            circuit, None, samples=GRADIENT_MAP_SAMPLES, seed=seed,
            objective=_scaled_fidelity_gradient(circuit, target), objective_name="scaled_fidelity",
        )
    return EvaluationCore(
        status="scored",
        fitness=float(fitness),
        objectives={
            "infidelity": {"value": 1.0 - fidelity, "direction": "minimize", "label": "Infidelity"},
            "cost": {"value": costs[cost_kind], "direction": "minimize", "label": f"Cost ({cost_kind})"},
        },
        descriptors={"two_qubit_gates": costs["two_qubit_gates"], "depth": costs["depth"]},
        metrics=metrics,
        guardrails=records,
        compute={"backend": "numpy", "method": "statevector_sampling"},
    )


SPEC = EvaluatorSpec(
    kind=KIND,
    version=VERSION,
    title="State preparation",
    description=(
        "Evolve a circuit that prepares a target state (GHZ, W, Dicke or Haar-random) with as few "
        "expensive gates as possible. The evaluator simulates the circuit itself, optimizes any free "
        "parameters with seeded Adam restarts, and charges the canonical two-qubit/depth/T cost."
    ),
    task="quantum_circuit",
    entry_signature="build(n_qubits: int) -> QuantumCircuit | cirq.Circuit",
    objectives=[
        {"key": "infidelity", "label": "Infidelity", "direction": "minimize"},
        {"key": "cost", "label": "Cost", "direction": "minimize"},
    ],
    descriptors=[
        {"key": "two_qubit_gates", "label": "Two-qubit gates", "min": 0, "max": 64, "default_bins": 8},
        {"key": "depth", "label": "Depth", "min": 0, "max": 64, "default_bins": 8},
    ],
    config_schema=CONFIG_SCHEMA,
    default_config=DEFAULT_CONFIG,
    stages=STAGES,
    calls=calls,
    score=score,
    validate_extra=validate_extra,
)
