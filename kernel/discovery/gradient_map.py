"""Microscope-in-the-loop: per-source-line gradient variances (addendum section C).

``gradient_map`` tells the LLM mutator *which lines of its own program* create
parameters that carry (almost) no gradient signal at random initialization.

Honesty rules
-------------
* Line numbers are 1-based lines of the candidate program, taken from
  ``IrGate.source_line`` (recovered by ``trace_gate_lines`` in the sandbox).
  Gates without a recovered line are omitted; nothing is ever guessed.
* ``variance`` of a line is the mean sampled gradient variance over the
  parameters created on that line; the line is ``dead`` only when EVERY one of
  those parameters has variance < ``DEAD_VARIANCE`` (1e-8).
* The variance is sampled: theta ~ U[0, 2*pi) drawn as
  ``default_rng(seed).uniform(0, 2*pi, (samples, m))``. When
  ``kernel.trainability.analyses.gradient_statistics`` is importable it does
  the sampling (``method="sampling"``); otherwise the same draw is made here
  from ``compile_circuit(...).value_and_grad``.
* The map describes the gradient of one specific objective, named in the
  ``objective`` field (``energy`` for VQE, ``scaled_fidelity`` = 2^n * F for
  state synthesis). It is not a statement about other objectives.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from kernel.trainability.compiler import compile_circuit
from kernel.trainability.ir import ParamCircuit, ParamRef
from kernel.trainability.pauli import PauliSum

DEAD_VARIANCE = 1e-8
METHOD = "statevector_sampling"
TWO_PI = 2.0 * math.pi

Objective = Callable[[np.ndarray], np.ndarray]


def sample_thetas(seed: int, samples: int, m: int, init: str = "uniform") -> np.ndarray:
    """The shared draw order: ``default_rng(seed).uniform(0, 2*pi, (samples, m))``.

    ``init="small"`` draws ``default_rng(seed).normal(0, 0.1, (samples, m))`` instead.
    """
    rng = np.random.default_rng(seed)
    if init == "small":
        return rng.normal(0.0, 0.1, (samples, m))
    return rng.uniform(0.0, TWO_PI, (samples, m))


def _analyses_gradient_statistics():
    try:
        from kernel.trainability.analyses import gradient_statistics
    except ImportError:
        return None
    return gradient_statistics


def gradient_variances(
    circuit: ParamCircuit,
    observable: PauliSum | None,
    *,
    samples: int,
    seed: int,
    objective: Objective | None = None,
    prefer_analyses: bool = True,
    init: str = "uniform",
) -> dict[str, Any]:
    """Per-parameter gradient variances (circuit.parameters order) and their mean.

    ``objective(values (S, m)) -> grads (S, m)`` replaces the Pauli observable
    (used for the fidelity objective). Returns ``{variances, variance_mean, source}``.
    """
    m = len(circuit.parameters)
    if m == 0:
        return {"variances": np.zeros(0), "variance_mean": 0.0, "source": "direct"}
    stats = _analyses_gradient_statistics() if (prefer_analyses and objective is None) else None
    if stats is not None and observable is not None:
        result = stats(circuit, observable, samples=samples, seed=seed, init=init, method="sampling")
        by_name = {row["name"]: float(row["variance"]) for row in result["per_parameter"]}
        variances = np.array([by_name[name] for name in circuit.parameters], dtype=np.float64)
        return {"variances": variances, "variance_mean": float(result["variance_mean"]), "source": "analyses"}
    thetas = sample_thetas(seed, samples, m, init)
    if objective is not None:
        grads = objective(thetas)
    else:
        if observable is None:
            raise ValueError("gradient_variances needs an observable or an objective")
        _, grads = compile_circuit(circuit).value_and_grad(thetas, observable)
    variances = np.var(grads, axis=0, ddof=1) if samples > 1 else np.zeros(m)
    return {"variances": variances, "variance_mean": float(np.mean(variances)), "source": "direct"}


def _lines_to_parameters(circuit: ParamCircuit) -> dict[int, list[str]]:
    lines: dict[int, list[str]] = {}
    for gate in circuit.gates:
        if gate.source_line is None:
            continue
        names = [a.name for a in gate.angles if isinstance(a, ParamRef)]
        if not names:
            continue
        bucket = lines.setdefault(gate.source_line, [])
        bucket.extend(n for n in names if n not in bucket)
    return dict(sorted(lines.items()))


def gradient_map(
    circuit: ParamCircuit,
    observable: PauliSum | None,
    *,
    samples: int,
    seed: int,
    objective: Objective | None = None,
    objective_name: str = "energy",
) -> dict[str, Any]:
    """Addendum-C gradient map for ``circuit`` (see module doc for the rules)."""
    lines = _lines_to_parameters(circuit)
    entries: list[dict[str, Any]] = []
    if lines:
        stats = gradient_variances(circuit, observable, samples=samples, seed=seed, objective=objective)
        variance_of = dict(zip(circuit.parameters, stats["variances"].tolist()))
        for line, names in lines.items():
            per_param = [variance_of[name] for name in names]
            entries.append({
                "line": line,
                "parameters": list(names),
                "variance": float(sum(per_param) / len(per_param)),
                "dead": max(per_param) < DEAD_VARIANCE,
            })
    dead = sum(1 for entry in entries if entry["dead"])
    return {
        "method": METHOD,
        "objective": objective_name,
        "samples": samples,
        "n_qubits": circuit.n_qubits,
        "lines": entries,
        "dead_fraction": (dead / len(entries)) if entries else 0.0,
    }
