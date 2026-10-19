"""Audit for the ``state_synthesis`` evaluator (addendum section F).

* Fidelity is recomputed with the NAIVE reference oracle
  (``kernel/trainability/reference.py``), never the compiler: at the
  evaluator's reported best parameters when ``metrics.best_theta`` exists,
  otherwise after re-optimizing with fresh restarts. The compiler is also
  compared with the oracle, state by state, so a compiler bug cannot hide.
* Cost is recomputed by an independent decomposition: the IR is rebuilt as a
  Qiskit circuit and transpiled to ``['cx', 'u']`` at optimization level 0. The
  canonical cost must be at least the real CX count, so a composite gate never
  looks cheaper than what it compiles to.
"""

from __future__ import annotations

import threading
from typing import Any, Callable

import numpy as np

from kernel.discovery.audits._common import (
    FAIL, PASS, SKIPPED, WARN, check, derive_seed, guarded, not_reached, result, scored_metric,
)
from kernel.discovery.evaluators._circuit_common import (
    adam_minimize, circuit_costs, dropped_measurements, initial_parameters,
)
from kernel.discovery.evaluators._fidelity import fidelity_value_and_grad
from kernel.discovery.targets import TargetError, target_state
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit
from kernel.trainability.reference import reference_state

EXACT_TOLERANCE = 1e-6
OVERCLAIM_WARN = 0.02
ORACLE_AGREEMENT = 1.0 - 1e-9
MIN_RESTARTS = 16
STEP_FACTOR = 1.5
PROBE_VALUE = 0.37  # generic non-degenerate angle used when only the gate structure matters

_QISKIT_1Q = {"H": "h", "X": "x", "Y": "y", "Z": "z", "S": "s", "SDG": "sdg", "T": "t", "TDG": "tdg", "SX": "sx", "SXDG": "sxdg"}
_QISKIT_ROT = {
    "RX": "rx", "RY": "ry", "RZ": "rz", "P": "p", "CRX": "crx", "CRY": "cry", "CRZ": "crz", "CP": "cp",
    "RXX": "rxx", "RYY": "ryy", "RZZ": "rzz", "RZX": "rzx",
}
_QISKIT_FIXED = {
    "CX": "cx", "CY": "cy", "CZ": "cz", "CH": "ch", "SWAP": "swap", "ISWAP": "iswap",
    "CCX": "ccx", "CCZ": "ccz", "CSWAP": "cswap",
}


def rebuild_qiskit(circuit: ParamCircuit, values: np.ndarray):
    """Independent Qiskit rendering of the IR (structure only matters for cost)."""
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(circuit.n_qubits)
    for gate, angles in circuit.bind_vector(values):
        name = gate.name
        if name in _QISKIT_1Q:
            getattr(qc, _QISKIT_1Q[name])(*gate.qubits)
        elif name in _QISKIT_ROT:
            getattr(qc, _QISKIT_ROT[name])(*angles, *gate.qubits)
        elif name in _QISKIT_FIXED:
            getattr(qc, _QISKIT_FIXED[name])(*gate.qubits)
        elif name == "U":
            qc.u(*angles, *gate.qubits)
        elif name != "I":
            raise ValueError(f"no independent Qiskit rendering for IR gate {name}")
    return qc


def transpiled_cx_count(circuit: ParamCircuit, values: np.ndarray) -> int:
    from qiskit import transpile

    compiled = transpile(rebuild_qiskit(circuit, values), basis_gates=["cx", "u"], optimization_level=0)
    return int(compiled.count_ops().get("cx", 0))


def _oracle_fidelity(circuit: ParamCircuit, theta: np.ndarray, target: np.ndarray) -> float:
    psi = reference_state(circuit, theta)
    return float(abs(np.vdot(target, psi)) ** 2)


def _reoptimize(circuit: ParamCircuit, target: np.ndarray, config: dict[str, Any], seed: int, cancel) -> np.ndarray:
    """Fresh restarts (more than the evaluator used); returns the (restarts, m) final thetas."""
    opt = config["optimize_parameters"]
    program = compile_circuit(circuit)
    theta0 = initial_parameters(
        np.random.default_rng(derive_seed(seed, "theta0")), max(MIN_RESTARTS, 2 * opt["restarts"]),
        len(circuit.parameters), "uniform",
    )

    def negative(theta: np.ndarray):
        value, grad = fidelity_value_and_grad(program, theta, target)
        return -value, -grad

    out = adam_minimize(
        negative, theta0, steps=int(opt["steps"] * STEP_FACTOR), learning_rate=opt["learning_rate"], cancel=cancel,
    )
    return out["best_theta"]


def _best_oracle_fidelity(circuit, target, config, evaluation, seed, cancel) -> tuple[float, np.ndarray, str]:
    m = len(circuit.parameters)
    if m == 0:
        theta = np.zeros(0)
        return _oracle_fidelity(circuit, theta, target), theta, "no free parameters"
    reported = scored_metric(evaluation, "best_theta")
    if isinstance(reported, list) and len(reported) != m:
        raise ValueError(f"reported best_theta has {len(reported)} entries for {m} parameters")
    if isinstance(reported, list):
        theta = np.asarray(reported, dtype=float)
        return _oracle_fidelity(circuit, theta, target), theta, "evaluator's reported best_theta"
    candidates = _reoptimize(circuit, target, config, seed, cancel)
    scored = [(_oracle_fidelity(circuit, row, target), row) for row in candidates]
    best_f, best_theta = max(scored, key=lambda item: item[0])
    return best_f, best_theta, "fresh re-optimization"


def _check_oracle_vs_compiler(circuit: ParamCircuit, theta: np.ndarray, seed: int) -> tuple[str, str | None]:
    m = len(circuit.parameters)
    rng = np.random.default_rng(derive_seed(seed, "probe"))
    probes = np.vstack([theta.reshape(1, m), rng.uniform(0, 2 * np.pi, (3, m))]) if m else np.zeros((1, 0))
    program = compile_circuit(circuit)
    states = program.states(probes)
    for row, state in zip(probes, states):
        overlap = abs(np.vdot(reference_state(circuit, row), state)) ** 2
        if overlap < ORACLE_AGREEMENT:
            return FAIL, f"the compiler's state differs from the naive oracle (overlap {overlap:.12f}); fidelity is untrustworthy."
    return PASS, None


def _check_fidelity(evaluation, audit_f: float, source: str, m: int) -> tuple[str, str | None]:
    claimed = scored_metric(evaluation, "fidelity")
    if not isinstance(claimed, (int, float)):
        return SKIPPED, "the evaluation has no fidelity to compare with."
    exact = m == 0 or source.startswith("evaluator")
    if exact and abs(claimed - audit_f) > EXACT_TOLERANCE:
        return FAIL, f"evaluator claims F={claimed:.6f} but the oracle ({source}) gives F={audit_f:.6f}."
    if claimed > audit_f + OVERCLAIM_WARN:
        status = FAIL if exact else WARN
        return status, f"evaluator claims F={claimed:.6f} but the oracle ({source}) gives F={audit_f:.6f}."
    return PASS, f"oracle F={audit_f:.6f} via {source}; evaluator F={claimed:.6f}"


def _check_cost(circuit: ParamCircuit, theta: np.ndarray, evaluation, cost_kind: str) -> tuple[str, str | None, int]:
    canonical = circuit_costs(circuit)
    values = theta if len(theta) == len(circuit.parameters) and len(theta) else np.full(len(circuit.parameters), PROBE_VALUE)
    real = transpiled_cx_count(circuit, values)
    effective = canonical[cost_kind]
    if canonical["two_qubit_gates"] < real:
        return FAIL, (
            f"canonical two-qubit cost {canonical['two_qubit_gates']} is below the {real} CX the circuit really "
            "compiles to; a composite gate looks cheaper than its decomposition."
        ), effective
    if cost_kind == "two_qubit_gates":
        effective = max(canonical["two_qubit_gates"], real)
    reported = (evaluation.get("descriptors") or {}).get("two_qubit_gates") if isinstance(evaluation, dict) else None
    if reported is not None and reported != canonical["two_qubit_gates"]:
        return FAIL, f"evaluator reported {reported} two-qubit gates, the fresh circuit has {canonical['two_qubit_gates']}.", effective
    return PASS, f"canonical {canonical['two_qubit_gates']} >= transpiled CX {real}", effective


def audit(
    config: dict[str, Any],
    artifacts: list[dict[str, Any]],
    seed: int,
    *,
    evaluation: dict[str, Any],
    progress: Callable[[float, str], None] | None = None,
    cancel: threading.Event | None = None,
    cache_dir: str | None = None,
) -> dict[str, Any]:
    notes: list[str] = []
    artifact = next((a.get("artifact") for a in artifacts if a.get("call_index") == 0), None)
    try:
        if not isinstance(artifact, dict) or artifact.get("ir_error"):
            raise IrError("invalid_ir", (artifact or {}).get("ir_error", {}).get("message", "no circuit artifact"))
        circuit = ParamCircuit.from_json(artifact.get("ir"))
        target = target_state(config["target"])
    except (IrError, TargetError) as exc:
        return result([check("ir_valid", "Fresh IR re-validated", FAIL, f"{exc}"[:500])], None, notes)
    checks = [check("ir_valid", "Fresh IR re-validated", PASS)]
    note = dropped_measurements(circuit)
    checks.append(check("no_measurement", "No measurements", FAIL if note else PASS, note))
    n = config["target"]["n_qubits"]
    checks.append(check("qubit_count", f"Exactly {n} qubits", PASS if circuit.n_qubits == n else FAIL,
                        None if circuit.n_qubits == n else f"uses {circuit.n_qubits} qubits"))
    try:
        audit_f, theta, source = _best_oracle_fidelity(circuit, target, config, evaluation, seed, cancel)
    except IrError as exc:
        checks.append(check("oracle_fidelity", "Oracle fidelity", SKIPPED, f"{exc}"))
        return result(checks, None, notes)
    except ValueError as exc:  # a reported best_theta that does not fit the circuit
        checks.append(check("fidelity_reproduced", "Fidelity reproduced by the oracle", FAIL, f"{exc}"[:300]))
        return result(checks, None, notes)
    notes.append(f"oracle fidelity {audit_f:.6f} ({source})")
    m = len(circuit.parameters)
    checks.append(guarded("oracle_vs_compiler", "Compiler agrees with the naive oracle",
                          lambda: _check_oracle_vs_compiler(circuit, theta, seed)))
    checks.append(guarded("fidelity_reproduced", "Fidelity reproduced by the oracle",
                          lambda: _check_fidelity(evaluation, audit_f, source, m)))
    cost_kind = config["cost"]
    cost_holder: dict[str, int] = {}

    def cost_check() -> tuple[str, str | None]:
        status, detail, effective = _check_cost(circuit, theta, evaluation, cost_kind)
        cost_holder["cost"] = effective
        return status, detail

    checks.append(guarded("cost_decomposition", "Cost is not below the real compiled CX count", cost_check))
    cost = cost_holder.get("cost", circuit_costs(circuit)[cost_kind])
    threshold = config["fidelity_threshold"]
    fitness = 10.0 * min(min(max(audit_f, 0.0), 1.0) / threshold, 1.0) - config["cost_weight"] * cost
    checks.append(_fitness_check(evaluation, fitness, m))
    return result(checks, float(fitness), notes)


def _fitness_check(evaluation: dict[str, Any], fitness: float, m: int) -> dict[str, Any]:
    claimed = evaluation.get("fitness") if isinstance(evaluation, dict) else None
    if not isinstance(claimed, (int, float)):
        return not_reached("fitness_reproduced", "Fitness reproduced", "the evaluation has no fitness")
    if m == 0 and abs(claimed - fitness) > EXACT_TOLERANCE:
        return check("fitness_reproduced", "Fitness reproduced", FAIL,
                     f"evaluator fitness {claimed:.6f} != audit fitness {fitness:.6f} for a parameter-free circuit.")
    return check("fitness_reproduced", "Fitness reproduced", PASS, f"gap {claimed - fitness:+.6f}")
