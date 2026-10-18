"""``vqe_ground_state`` — a variational ansatz for a Hamiltonian ground state (PRD 14 spec 6.3).

The candidate's ``build(n_qubits)`` returns a parameterized circuit. This
trusted scorer re-validates the IR, filters barren-plateau ansatzes, trains the
parameters itself (seeded Adam restarts on batched adjoint gradients) and
compares against the exact ground energy.

Notes
-----
* ``init``: ``uniform`` is theta ~ U[0, 2*pi); ``small`` is theta ~ N(0, 0.1^2).
  The trainability prefilter samples the same distribution that training uses.
* ``E_best`` is re-measured with ``expectations()`` at the best parameters
  rather than trusting the adjoint pass, then checked against the variational
  bound ``E_best >= E0 - 1e-8``. A violation can only be an evaluator bug, so
  it is reported as ``failed`` (never scored, never blamed on the candidate).
* The prefilter calls ``kernel.trainability.analyses.gradient_statistics`` with
  ``method="sampling"`` when importable (see ``gradient_map.gradient_variances``).
"""

from __future__ import annotations

import math
import threading
from typing import Any, Callable

import numpy as np

from kernel.discovery.evaluators._circuit_common import (
    CircuitHolder,
    adam_minimize,
    circuit_costs,
    effective_parameter_counts,
    initial_parameters,
    ir_conversion_check,
    parameter_budget_check,
    promote_fixed_angles,
    qubit_count_check,
    thin_curve,
)
from kernel.discovery.evaluators.base import EvaluationCore, EvaluatorSpec
from kernel.discovery.evaluators.guardrails import FAIL, PASS, SKIPPED, Guardrail, record, run_guardrails
from kernel.discovery.gradient_map import gradient_map, gradient_variances
from kernel.discovery.hamiltonians import (
    KINDS as HAMILTONIAN_KINDS,
    HamiltonianError,
    build_hamiltonian,
    exact_ground_energy,
)
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrError
from kernel.trainability.pauli import PauliSum

KIND = "vqe_ground_state"
VERSION = "1.0.0"
BOUND_TOLERANCE = 1e-8
RELATIVE_FLOOR = 1e-12
CURVE_POINTS = 50

DEFAULT_CONFIG: dict[str, Any] = {
    "hamiltonian": {"kind": "tfim", "n_qubits": 6, "h": 1.0, "delta": 0.5, "periodic": False},
    "training": {"steps": 200, "restarts": 4, "learning_rate": 0.05, "init": "uniform"},
    "trainability_prefilter": {"enabled": True, "samples": 64, "min_variance": 1e-5},
    "max_parameters": 200,
    "cost_weight": 0.002,
}

CONFIG_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "hamiltonian": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "kind": {"enum": list(HAMILTONIAN_KINDS)},
                "n_qubits": {"type": "integer", "minimum": 2, "maximum": 12},
                "h": {"type": "number", "minimum": -100, "maximum": 100},
                "delta": {"type": "number", "minimum": -100, "maximum": 100},
                "periodic": {"type": "boolean"},
                "pauli": {"type": "string", "minLength": 1},
            },
        },
        "training": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "steps": {"type": "integer", "minimum": 1, "maximum": 5000},
                "restarts": {"type": "integer", "minimum": 1, "maximum": 32},
                "learning_rate": {"type": "number", "minimum": 1e-4, "maximum": 1},
                "init": {"enum": ["uniform", "small"]},
            },
        },
        "trainability_prefilter": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "enabled": {"type": "boolean"},
                "samples": {"type": "integer", "minimum": 2, "maximum": 1024},
                "min_variance": {
                    "type": "number", "minimum": 0, "maximum": 1,
                    "description": (
                        "Reject ansatzes whose mean initial gradient variance is below this. "
                        "The 1e-5 default only catches severe plateaus: a deep 2-design-like global "
                        "cost (Z on every qubit) measures about 1.7e-3 at n=8 and 4.6e-4 at n=10, "
                        "far above it. Raise it (e.g. 1e-3) to be stricter at small n."
                    ),
                },
            },
        },
        "max_parameters": {"type": "integer", "minimum": 1, "maximum": 1024},
        "cost_weight": {"type": "number", "minimum": 0, "maximum": 10},
    },
}

STAGES: dict[str, dict[str, Any]] = {
    "screen": {"training": {"restarts": 1, "steps": 50}, "trainability_prefilter": {"samples": 32}},
    "full": {},
    "confirm": {},
}


def validate_extra(config: dict[str, Any]) -> str | None:
    """Reject Hamiltonians we cannot solve exactly (n > 10 without scipy) up front."""
    try:
        hamiltonian = build_hamiltonian(config["hamiltonian"])
        exact_cost_ok = config["hamiltonian"]["n_qubits"] <= 10 or _has_scipy()
    except HamiltonianError as exc:
        return str(exc)
    if hamiltonian.max_qubit() >= config["hamiltonian"]["n_qubits"]:
        return "hamiltonian touches a qubit outside n_qubits"
    return None if exact_cost_ok else "exact ground energy for n > 10 needs scipy, which is not installed"


def _has_scipy() -> bool:
    try:
        import scipy.sparse.linalg  # noqa: F401
    except ImportError:
        return False
    return True


def calls(config: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"args": [config["hamiltonian"]["n_qubits"]], "kwargs": {}}]


def _ir_conversion_check(holder: CircuitHolder, artifact: Any) -> tuple[str, str | None]:
    """Parse the IR, then promote hard-coded non-Clifford angles to evaluator-trained parameters."""
    status, detail = ir_conversion_check(holder, artifact)
    if status == PASS and holder.circuit is not None:
        holder.extras["submitted"] = holder.circuit
        holder.circuit = promote_fixed_angles(holder.circuit)
    return status, detail


def _has_parameters_check(holder: CircuitHolder) -> tuple[str, str | None]:
    submitted = holder.extras.get("submitted")  # the candidate must offer at least one genuinely free parameter
    if submitted is None or not submitted.parameters:
        return FAIL, "The ansatz has no free parameters, so there is nothing to train."
    return PASS, None


def _prefilter_check(
    holder: CircuitHolder, hamiltonian: PauliSum, config: dict[str, Any], seed: int
) -> tuple[str, str | None]:
    """Reject ansatzes with a barren plateau at initialization.

    The default ``min_variance`` (1e-5) is deliberately lax and only catches severe
    plateaus. Reference values (deep hardware-efficient ansatz, uniform init, mean
    over parameters): a global cost Z^n has variance ~1.7e-3 at n=8 and ~4.6e-4 at
    n=10, i.e. it passes the default even though it decays as ~2^-n.
    """
    settings = config["trainability_prefilter"]
    if not settings["enabled"]:
        return PASS, "prefilter disabled by config"
    stats = gradient_variances(
        holder.circuit, hamiltonian, samples=settings["samples"], seed=seed,
        init=config["training"]["init"],
    )
    variance = stats["variance_mean"]
    holder.extras["prefilter"] = {
        "variance_mean": variance, "min_variance": settings["min_variance"],
        "samples": settings["samples"], "source": stats["source"], "init": config["training"]["init"],
    }
    if variance < settings["min_variance"]:
        return FAIL, (
            f"barren plateau at initialization: mean gradient variance {variance:.3e} "
            f"is below the minimum {settings['min_variance']:.0e}."
        )
    return PASS, f"mean gradient variance {variance:.3e}"


def _guardrails(
    holder: CircuitHolder, artifact: Any, hamiltonian: PauliSum, config: dict[str, Any], seed: int
) -> list[Guardrail]:
    n = config["hamiltonian"]["n_qubits"]
    return [
        Guardrail("ir_conversion", "Circuit converts to elementary gates", lambda: _ir_conversion_check(holder, artifact)),
        Guardrail("qubit_count", f"Exactly {n} qubits", lambda: qubit_count_check(holder, n)),
        Guardrail(
            "parameter_budget", f"At most {config['max_parameters']} effective parameters (free + fixed non-Clifford angles)",
            lambda: parameter_budget_check(holder, config["max_parameters"], label="effective parameters"),
        ),
        Guardrail("has_parameters", "Has free parameters", lambda: _has_parameters_check(holder)),
        Guardrail(
            "trainability_prefilter", "Not in a barren plateau at initialization",
            lambda: _prefilter_check(holder, hamiltonian, config, seed),
        ),
    ]


BOUND_GUARDRAIL = Guardrail(
    "variational_bound", "Energy respects the variational bound", lambda: (PASS, None)
)


def _train(
    circuit, hamiltonian: PauliSum, config: dict[str, Any], seed: int,
    progress: Callable[[float, str], None] | None, cancel: threading.Event | None,
) -> dict[str, Any]:
    program = compile_circuit(circuit)
    training = config["training"]
    theta0 = initial_parameters(
        np.random.default_rng([abs(int(seed)), 1]), training["restarts"], len(circuit.parameters), training["init"]
    )
    result = adam_minimize(
        lambda theta: program.value_and_grad(theta, hamiltonian), theta0,
        steps=training["steps"], learning_rate=training["learning_rate"],
        cancel=cancel, progress=progress, label="training ansatz",
    )
    verified = program.expectations(result["best_theta"], hamiltonian)  # independent of the adjoint pass
    best = int(np.argmin(verified))
    curve = np.minimum.accumulate(result["history"][:, best])
    return {
        "e_best": float(verified[best]),
        "restart_energies": [float(x) for x in verified],
        "curve": thin_curve(curve, CURVE_POINTS),
        "best_restart": best,
        "best_theta": [float(x) for x in result["best_theta"][best]],
    }


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
    try:
        hamiltonian = build_hamiltonian(config["hamiltonian"])
        e0 = exact_ground_energy(hamiltonian, config["hamiltonian"]["n_qubits"])
    except HamiltonianError as exc:
        return EvaluationCore(
            status="failed", failure={"stage": "score", "code": "invalid_hamiltonian", "message": str(exc)}
        )
    holder = CircuitHolder()
    records, rejection = run_guardrails(_guardrails(holder, artifact, hamiltonian, config, seed))
    if rejection is not None:
        records.append(record(BOUND_GUARDRAIL, SKIPPED, "not reached: an earlier guardrail failed"))
        return EvaluationCore(status="rejected", guardrails=records, rejection=rejection)
    circuit = holder.circuit
    assert circuit is not None
    try:
        trained = _train(circuit, hamiltonian, config, seed, progress, cancel)
    except IrError as exc:
        return EvaluationCore(
            status="failed", guardrails=records, failure={"stage": "score", "code": exc.code, "message": exc.message}
        )
    if trained["e_best"] < e0 - BOUND_TOLERANCE:
        detail = (
            f"E_best={trained['e_best']:.10f} is below the exact ground energy E0={e0:.10f}; "
            "this is impossible for a valid simulation, so the evaluator is wrong, not the candidate."
        )
        records.append(record(BOUND_GUARDRAIL, FAIL, detail))
        return EvaluationCore(
            status="failed", guardrails=records,
            failure={"stage": "score", "code": "variational_bound_violated", "message": detail},
        )
    records.append(record(BOUND_GUARDRAIL, PASS, None))
    return _scored(circuit, hamiltonian, trained, e0, config, seed, holder, records)


def _scored(
    circuit, hamiltonian: PauliSum, trained: dict[str, Any], e0: float, config: dict[str, Any],
    seed: int, holder: CircuitHolder, records: list[dict[str, Any]],
) -> EvaluationCore:
    e_best = trained["e_best"]
    relative_error = max((e_best - e0) / max(abs(e0), RELATIVE_FLOOR), 0.0)
    counts = effective_parameter_counts(holder.extras["submitted"])
    n_params = len(circuit.parameters)  # == counts["effective_parameters"]: promoted constants are trained parameters
    costs = circuit_costs(circuit)
    fitness = -math.log10(max(relative_error, RELATIVE_FLOOR)) - config["cost_weight"] * n_params
    samples = config["trainability_prefilter"]["samples"]
    metrics = {
        "e_best": e_best,
        "e0": e0,
        "relative_energy_error": relative_error,
        "curve": trained["curve"],
        "restart_energies": trained["restart_energies"],
        "n_parameters": counts["n_free_parameters"],
        "n_fixed_nonclifford_angles": counts["n_fixed_nonclifford_angles"],
        "effective_parameters": n_params,
        "best_theta": trained["best_theta"],
        "parameter_names": list(circuit.parameters),
        "costs": costs,
        "prefilter": holder.extras.get("prefilter"),
        "gradient_map": gradient_map(circuit, hamiltonian, samples=samples, seed=seed, objective_name="energy"),
    }
    return EvaluationCore(
        status="scored",
        fitness=float(fitness),
        objectives={
            "relative_energy_error": {
                "value": relative_error, "direction": "minimize", "label": "Relative energy error",
            },
            "parameters": {"value": n_params, "direction": "minimize", "label": "Effective parameters"},
        },
        descriptors={"parameters": n_params, "two_qubit_gates": costs["two_qubit_gates"]},
        metrics=metrics,
        guardrails=records,
        compute={"backend": "numpy", "method": "statevector_sampling"},
    )


SPEC = EvaluatorSpec(
    kind=KIND,
    version=VERSION,
    title="Variational ground state",
    description=(
        "Evolve a variational ansatz for a spin-model ground state (TFIM, Heisenberg, XXZ or a Pauli sum). "
        "The evaluator filters barren-plateau ansatzes, trains the parameters itself with seeded Adam "
        "restarts, and compares the energy with the exact ground energy."
    ),
    task="quantum_circuit",
    entry_signature="build(n_qubits: int) -> QuantumCircuit | cirq.Circuit",
    objectives=[
        {"key": "relative_energy_error", "label": "Relative energy error", "direction": "minimize"},
        {"key": "parameters", "label": "Parameters", "direction": "minimize"},
    ],
    descriptors=[
        {"key": "parameters", "label": "Parameters", "min": 0, "max": 200, "default_bins": 8},
        {"key": "two_qubit_gates", "label": "Two-qubit gates", "min": 0, "max": 128, "default_bins": 8},
    ],
    config_schema=CONFIG_SCHEMA,
    default_config=DEFAULT_CONFIG,
    stages=STAGES,
    calls=calls,
    score=score,
    validate_extra=validate_extra,
)
