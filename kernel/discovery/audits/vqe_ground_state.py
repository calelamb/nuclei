"""Audit for the ``vqe_ground_state`` evaluator (addendum section F).

* The Hamiltonian is rebuilt as a dense matrix DIRECTLY from the config (own
  Kronecker products) and E0 is its dense ``eigh`` ground energy; both are
  compared with the evaluator's helpers.
* Energies are measured by the naive oracle (dense expectation). The evaluator's
  reported ``metrics.best_theta`` is replayed and must reproduce its claimed
  ``e_best`` to 1e-6 (hard fail); the audit also re-optimizes from fresh restarts.
* Parameter laundering: fixed non-Clifford angles are recounted independently and
  must be fully charged by the evaluator (``metrics.effective_parameters``); a
  circuit whose hard-coded angles dwarf its free parameters is flagged. The
  oracle then measures the circuit the evaluator trains: hard-coded non-Clifford
  angles promoted to trainable parameters (``promote_fixed_angles``).
* The variational bound is checked and the barren-plateau prefilter variance
  is re-measured with a different seed and twice the samples.
"""

from __future__ import annotations

import math
import threading
from typing import Any, Callable

import numpy as np

from kernel.discovery.audits._common import (
    FAIL, PASS, SKIPPED, WARN, check, derive_seed, guarded, result, scored_metric,
)
from kernel.discovery.evaluators._circuit_common import (
    adam_minimize, circuit_costs, initial_parameters, promote_fixed_angles,
)
from kernel.discovery.evaluators.vqe_ground_state import BOUND_TOLERANCE, RELATIVE_FLOOR
from kernel.discovery.gradient_map import gradient_variances
from kernel.discovery.hamiltonians import HamiltonianError, build_hamiltonian
from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import IrError, ParamCircuit, ParamRef
from kernel.trainability.pauli import ObservableError, parse_observable, pauli_sum_matrix
from kernel.trainability.reference import reference_observable_matrix, reference_state

DENSE_AUDIT_MAX_QUBITS = 11
E0_TOLERANCE = 1e-7
MIN_RESTARTS = 8
STEP_FACTOR = 1.5
REPRODUCE_WARN = 1e-3
VARIANCE_RATIO_WARN = 10.0
REPLAY_TOLERANCE = 1e-6
LAUNDERING_RATIO = 4  # hard-coded non-Clifford angles per free parameter above which the ansatz is flagged
LAUNDERING_MIN_FIXED = 4
_ANGLE_TOL = 1e-6  # constants printed to six digits (3.141593) still count as Clifford

_P = {
    "X": np.array([[0, 1], [1, 0]], dtype=np.complex128),
    "Y": np.array([[0, -1j], [1j, 0]], dtype=np.complex128),
    "Z": np.array([[1, 0], [0, -1]], dtype=np.complex128),
}


def _embed(n: int, ops: dict[int, str]) -> np.ndarray:
    """Kronecker product with qubit n-1 leftmost (qubit q is bit q)."""
    out = np.eye(1, dtype=np.complex128)
    for q in range(n - 1, -1, -1):
        out = np.kron(out, _P[ops[q]] if q in ops else np.eye(2, dtype=np.complex128))
    return out


def dense_hamiltonian(spec: dict[str, Any]) -> np.ndarray:
    """The dense Hamiltonian written straight from its definition (no evaluator helper)."""
    n, kind = int(spec["n_qubits"]), spec["kind"]
    periodic = bool(spec.get("periodic", False)) and n >= 3
    bonds = [(i, i + 1) for i in range(n - 1)] + ([(n - 1, 0)] if periodic else [])
    total = np.zeros((1 << n, 1 << n), dtype=np.complex128)
    if kind == "tfim":
        for i, j in bonds:
            total -= _embed(n, {i: "Z", j: "Z"})
        for q in range(n):
            total -= float(spec.get("h", 1.0)) * _embed(n, {q: "X"})
    elif kind in ("heisenberg", "xxz"):
        delta = 1.0 if kind == "heisenberg" else float(spec.get("delta", 0.5))
        for i, j in bonds:
            total += _embed(n, {i: "X", j: "X"}) + _embed(n, {i: "Y", j: "Y"}) + delta * _embed(n, {i: "Z", j: "Z"})
    elif kind == "pauli":
        total = reference_observable_matrix(parse_observable(spec["pauli"], n), n)
    else:
        raise HamiltonianError(f"unknown hamiltonian kind {kind!r}")
    return total


def _oracle_energy(circuit: ParamCircuit, theta: np.ndarray, matrix: np.ndarray) -> float:
    psi = reference_state(circuit, theta)
    return float(np.real(np.vdot(psi, matrix @ psi)))


def _reoptimize(circuit, ps, config, seed, cancel) -> np.ndarray:
    training = config["training"]
    program = compile_circuit(circuit)
    theta0 = initial_parameters(
        np.random.default_rng(derive_seed(seed, "theta0")), max(MIN_RESTARTS, 2 * training["restarts"]),
        len(circuit.parameters), training["init"],
    )
    out = adam_minimize(
        lambda theta: program.value_and_grad(theta, ps), theta0,
        steps=int(training["steps"] * STEP_FACTOR), learning_rate=training["learning_rate"], cancel=cancel,
    )
    return out["best_theta"]


def _check_hamiltonian(spec: dict[str, Any], ps, n: int) -> tuple[str, str | None]:
    mine = dense_hamiltonian(spec)
    theirs = pauli_sum_matrix(ps, n)
    gap = float(np.max(np.abs(mine - theirs)))
    if gap > 1e-9:
        return FAIL, f"the evaluator's Hamiltonian differs from the directly built one (max entry gap {gap:.3e})."
    return PASS, None


def _check_e0(e0_audit: float, evaluation: dict[str, Any]) -> tuple[str, str | None]:
    claimed = scored_metric(evaluation, "e0")
    if not isinstance(claimed, (int, float)):
        return SKIPPED, "the evaluation reports no E0."
    if abs(claimed - e0_audit) > E0_TOLERANCE:
        return FAIL, f"evaluator E0={claimed:.10f} but dense eigh gives {e0_audit:.10f}."
    return PASS, f"E0={e0_audit:.10f}"


def _check_bound(e_audit: float, e0: float, evaluation: dict[str, Any]) -> tuple[str, str | None]:
    claimed = scored_metric(evaluation, "e_best")
    if e_audit < e0 - BOUND_TOLERANCE:
        return FAIL, f"audit energy {e_audit:.10f} is below E0={e0:.10f}: variational bound violated."
    if isinstance(claimed, (int, float)) and claimed < e0 - BOUND_TOLERANCE:
        return FAIL, f"evaluator's claimed E_best={claimed:.10f} is below E0={e0:.10f}: variational bound violated."
    return PASS, None


def _check_reproduced(e_audit: float, e0: float, evaluation: dict[str, Any]) -> tuple[str, str | None]:
    claimed = scored_metric(evaluation, "e_best")
    if not isinstance(claimed, (int, float)):
        return SKIPPED, "the evaluation reports no E_best."
    scale = max(abs(e0), RELATIVE_FLOOR)
    if claimed + REPRODUCE_WARN * scale < e_audit:
        return WARN, (
            f"evaluator reached E_best={claimed:.8f} but fresh restarts only reach "
            f"{e_audit:.8f}; the claim may depend on a lucky seed."
        )
    return PASS, f"audit E={e_audit:.8f}, evaluator E={claimed:.8f}"


def _on_grid(value: float, unit: float) -> bool:
    ratio = value / unit
    return abs(ratio - round(ratio)) * unit < _ANGLE_TOL


def fixed_angle_count(circuit: ParamCircuit) -> int:
    """Independent recount: constants that act like trained parameters.

    A fixed angle is free only on the Clifford grid (k*pi/2) or the T grid (odd k*pi/4); a later
    use of one free parameter is free only with an integer coefficient and a Clifford offset.
    """
    seen: set[str] = set()
    total = 0
    for gate in circuit.gates:
        for angle in gate.angles:
            if isinstance(angle, ParamRef):
                clean = abs(angle.coeff - round(angle.coeff)) < _ANGLE_TOL and _on_grid(angle.offset, math.pi / 2)
                total += int(angle.name in seen and not clean)
                seen.add(angle.name)
            else:
                total += int(not (_on_grid(float(angle), math.pi / 4)))
    return total


def _check_laundering(circuit: ParamCircuit, evaluation: dict[str, Any]) -> tuple[str, str | None]:
    fixed, free = fixed_angle_count(circuit), len(circuit.parameters)
    charged = scored_metric(evaluation, "effective_parameters")
    if isinstance(charged, (int, float)) and charged < free + fixed:
        return FAIL, (
            f"the evaluator charged {charged} effective parameters but the circuit has {free} free + {fixed} "
            "hard-coded non-Clifford angles: parameter laundering."
        )
    if fixed >= LAUNDERING_MIN_FIXED and fixed > LAUNDERING_RATIO * max(free, 1):
        return FAIL, (
            f"{fixed} hard-coded non-Clifford angles versus {free} free parameter(s): the ansatz looks "
            "pre-trained offline (parameter laundering) rather than trained by the evaluator."
        )
    return PASS, f"{free} free + {fixed} fixed non-Clifford angles"


def _check_replay(circuit, matrix, evaluation) -> tuple[str, str | None]:
    claimed, reported = scored_metric(evaluation, "e_best"), scored_metric(evaluation, "best_theta")
    if reported is None or not isinstance(claimed, (int, float)):
        return SKIPPED, "the evaluation reports no best_theta to replay."
    if not (isinstance(reported, list) and len(reported) == len(circuit.parameters)):
        return FAIL, f"best_theta has the wrong length for the circuit's {len(circuit.parameters)} parameters."
    energy = _oracle_energy(circuit, np.asarray(reported, dtype=float), matrix)
    if abs(energy - claimed) > REPLAY_TOLERANCE:
        return FAIL, f"best_theta gives E={energy:.10f} under the oracle but the evaluator claims E_best={claimed:.10f}."
    return PASS, f"replayed E={energy:.10f}"


def _check_prefilter(circuit, ps, config, seed, evaluation) -> tuple[str, str | None]:
    settings = config["trainability_prefilter"]
    if not settings["enabled"]:
        return PASS, "prefilter disabled by config"
    stats = gradient_variances(
        circuit, ps, samples=2 * settings["samples"], seed=derive_seed(seed, "prefilter"), init=config["training"]["init"],
    )
    variance = stats["variance_mean"]
    if variance < settings["min_variance"]:
        return FAIL, (
            f"with a different seed the mean gradient variance is {variance:.3e}, below the minimum "
            f"{settings['min_variance']:.0e}."
        )
    prior = (scored_metric(evaluation, "prefilter") or {}).get("variance_mean")
    if isinstance(prior, (int, float)) and prior > 0 and variance > 0:
        ratio = max(prior / variance, variance / prior)
        if ratio > VARIANCE_RATIO_WARN:
            return WARN, f"gradient variance {variance:.3e} differs {ratio:.1f}x from the evaluator's {prior:.3e}."
    return PASS, f"mean gradient variance {variance:.3e}"


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
    spec = config["hamiltonian"]
    n = spec["n_qubits"]
    artifact = next((a.get("artifact") for a in artifacts if a.get("call_index") == 0), None)
    try:
        if not isinstance(artifact, dict) or artifact.get("ir_error"):
            raise IrError("invalid_ir", str((artifact or {}).get("ir_error", "no circuit artifact")))
        submitted = ParamCircuit.from_json(artifact.get("ir"))
        circuit = promote_fixed_angles(submitted)  # the circuit the evaluator actually trains and measures
        ps = build_hamiltonian(spec)
    except (IrError, HamiltonianError) as exc:
        return result([check("ir_valid", "Fresh IR re-validated", FAIL, f"{exc}"[:500])], None, notes)
    checks = [check("ir_valid", "Fresh IR re-validated", PASS)]
    qubits_ok = circuit.n_qubits == n and bool(submitted.parameters)
    checks.append(check("ansatz_shape", "Right width and has parameters", PASS if qubits_ok else FAIL,
                        None if qubits_ok else f"{circuit.n_qubits} qubits, {len(submitted.parameters)} free parameters"))
    if n > DENSE_AUDIT_MAX_QUBITS or not qubits_ok:
        checks.append(check("dense_oracle", "Dense oracle energies", SKIPPED,
                            f"dense audit supports at most {DENSE_AUDIT_MAX_QUBITS} qubits." if qubits_ok else "bad ansatz"))
        return result(checks, None, notes)
    try:
        matrix = dense_hamiltonian(spec)
    except (HamiltonianError, ObservableError, KeyError) as exc:
        checks.append(check("hamiltonian_rebuilt", "Hamiltonian rebuilt directly", SKIPPED, f"{exc}"[:300]))
        return result(checks, None, notes)
    e0 = float(np.linalg.eigvalsh(matrix)[0])
    checks.append(guarded("hamiltonian_rebuilt", "Hamiltonian rebuilt directly matches the evaluator's",
                          lambda: _check_hamiltonian(spec, ps, n)))
    checks.append(guarded("ground_energy", "E0 from dense eigh matches the evaluator's", lambda: _check_e0(e0, evaluation)))
    checks.append(guarded("best_theta_replay", "Reported best_theta reproduces the claimed energy",
                          lambda: _check_replay(circuit, matrix, evaluation)))
    checks.append(guarded("parameter_laundering", "No hard-coded pre-trained angles", lambda: _check_laundering(submitted, evaluation)))
    thetas = _reoptimize(circuit, ps, config, seed, cancel)
    energies = [_oracle_energy(circuit, row, matrix) for row in thetas]
    e_audit = float(min(energies))
    notes.append(f"oracle energy {e_audit:.10f} over {len(energies)} fresh restarts; E0={e0:.10f}")
    program = compile_circuit(circuit)
    drift = abs(float(program.expectations(thetas[int(np.argmin(energies))].reshape(1, -1), ps)[0]) - e_audit)
    checks.append(check("oracle_vs_compiler", "Compiler energy agrees with the naive oracle",
                        FAIL if drift > 1e-8 else PASS, f"compiler/oracle gap {drift:.3e}" if drift > 1e-8 else None))
    checks.append(guarded("variational_bound", "Variational bound holds", lambda: _check_bound(e_audit, e0, evaluation)))
    checks.append(guarded("energy_reproduced", "Energy reproduced from fresh restarts",
                          lambda: _check_reproduced(e_audit, e0, evaluation)))
    checks.append(guarded("prefilter_variance", "Gradient variance holds under a different seed",
                          lambda: _check_prefilter(circuit, ps, config, seed, evaluation)))
    relative = max((e_audit - e0) / max(abs(e0), RELATIVE_FLOOR), 0.0)
    fitness = -math.log10(max(relative, RELATIVE_FLOOR)) - config["cost_weight"] * len(circuit.parameters)
    notes.append(f"costs: {circuit_costs(circuit)}")
    return result(checks, float(fitness), notes)
