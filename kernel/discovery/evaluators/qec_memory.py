"""``qec_memory`` — the QEC memory-experiment evaluator (PRD 14 spec 6.3).

The candidate's ``build(distance, rounds)`` returns a NOISELESS Stim circuit.
This trusted scorer re-parses the artifact text, runs the ten guardrails in
order, applies the configured noise itself, decodes with PyMatching and
reports per-round logical error rates with Wilson-based 95% intervals.
"""

from __future__ import annotations

import os
import threading
from typing import Any, Callable

from kernel.discovery.cost import stim_two_qubit_cost
from kernel.discovery.evaluators.base import EvaluationCore, EvaluatorSpec
from kernel.discovery.evaluators.guardrails import run_guardrails
from kernel.discovery.evaluators.qec_guardrails import Case, build_guardrails
from kernel.discovery.evaluators.qec_stats import (
    derive_seed,
    lambda_ratio,
    round_summary,
    sample_logical_errors,
)
from kernel.discovery.noise import MODELS

import math

KIND = "qec_memory"
VERSION = "1.0.0"
FITNESS_FLOOR = 1e-15

DEFAULT_ALLOWED_GATES = [
    "H", "S", "S_DAG", "SQRT_X", "SQRT_X_DAG", "X", "Y", "Z", "CX", "CY", "CZ", "SWAP",
    "R", "RX", "RY", "M", "MX", "MY", "MR", "MRX", "MRY", "TICK", "DETECTOR",
    "OBSERVABLE_INCLUDE", "QUBIT_COORDS", "SHIFT_COORDS", "REPEAT",
]

DEFAULT_CONFIG: dict[str, Any] = {
    "distances": [3, 5],
    "rounds": "d",
    "noise": {"model": "uniform", "p": 1e-3, "bias": 10},
    "decoder": "pymatching",
    "shots": {"min": 1000, "max": 200000, "max_errors": 200},
    "max_qubits": 200,
    "allowed_gates": DEFAULT_ALLOWED_GATES,
}

CONFIG_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "distances": {
            "type": "array", "minItems": 1, "maxItems": 4,
            "items": {"type": "integer", "minimum": 2, "maximum": 15},
        },
        "rounds": {"anyOf": [{"const": "d"}, {"type": "integer", "minimum": 1, "maximum": 100}]},
        "noise": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "model": {"enum": list(MODELS)},
                "p": {"type": "number", "minimum": 1e-4, "maximum": 0.05},
                "bias": {"type": "number", "minimum": 1, "maximum": 1000},
            },
        },
        "decoder": {"enum": ["pymatching"]},
        "shots": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "min": {"type": "integer", "minimum": 100, "maximum": 1000000},
                "max": {"type": "integer", "minimum": 100, "maximum": 1000000},
                "max_errors": {"type": "integer", "minimum": 1, "maximum": 1000000},
            },
        },
        "max_qubits": {"type": "integer", "minimum": 1, "maximum": 2000},
        "allowed_gates": {"type": "array", "minItems": 1, "items": {"type": "string", "minLength": 1}},
    },
}

STAGES: dict[str, dict[str, Any]] = {
    "screen": {"shots": {"min": 1000, "max": 5000, "max_errors": 50}},
    "full": {},
    "confirm": {},
}


def _rounds_for(config: dict[str, Any], distance: int) -> int:
    return distance if config["rounds"] == "d" else int(config["rounds"])


def calls(config: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"args": [d, _rounds_for(config, d)], "kwargs": {}}
        for d in config["distances"]
    ]


def validate_extra(config: dict[str, Any]) -> str | None:
    distances = config["distances"]
    if any(b <= a for a, b in zip(distances, distances[1:])):
        return "distances must be strictly increasing"
    shots = config["shots"]
    if shots["min"] > shots["max"]:
        return "shots.min must not exceed shots.max"
    return None


def _cases(config: dict[str, Any], artifacts: list[dict[str, Any]]) -> list[Case]:
    by_index = {a["call_index"]: a["artifact"] for a in artifacts}
    cases = []
    for index, d in enumerate(config["distances"]):
        artifact = by_index.get(index)
        if not isinstance(artifact, dict) or not isinstance(artifact.get("circuit_text"), str):
            raise ValueError(f"missing circuit_text artifact for call {index}")
        cases.append(Case(d, _rounds_for(config, d), artifact["circuit_text"]))
    return cases


def _distance_metrics(case: Case, config: dict[str, Any], seed: int, cancel) -> dict[str, Any]:
    shots_cfg = config["shots"]
    shots, errors = sample_logical_errors(
        case.noisy, case.dem,
        seed=derive_seed(seed, case.distance),
        min_shots=shots_cfg["min"], max_shots=shots_cfg["max"], max_errors=shots_cfg["max_errors"],
        cancel=cancel,
    )
    summary = round_summary(errors, shots, case.rounds)
    two_qubit = stim_two_qubit_cost(case.circuit)
    return {
        "d": case.distance,
        "rounds": case.rounds,
        "shots": shots,
        "errors": errors,
        **summary,
        "fault_distance": case.fault.weight if case.fault else None,
        "fault_distance_method": case.fault.method if case.fault else None,
        "qubits": case.circuit.num_qubits,
        "detectors": case.circuit.num_detectors,
        "two_qubit_gates": two_qubit,
    }


def _number(value: float) -> float | int:
    rounded = round(value, 3)
    return int(rounded) if rounded == int(rounded) else rounded


def _scored(per_distance: list[dict[str, Any]], guardrails: list[dict[str, Any]]) -> EvaluationCore:
    largest = per_distance[-1]
    fitness = sum(-math.log10(max(m["ci95"][1], FITNESS_FLOOR)) for m in per_distance) / len(per_distance)
    lambdas = [lambda_ratio(a, b) for a, b in zip(per_distance, per_distance[1:])]
    return EvaluationCore(
        status="scored",
        fitness=fitness,
        objectives={
            "logical_error_per_round": {
                "value": largest["ler_round"], "ci95": largest["ci95"],
                "direction": "minimize", "label": "Logical error / round",
            },
            "qubits": {"value": largest["qubits"], "direction": "minimize", "label": "Physical qubits"},
        },
        descriptors={
            "qubits": largest["qubits"],
            "two_qubit_gates_per_round": _number(largest["two_qubit_gates"] / largest["rounds"]),
        },
        metrics={"per_distance": per_distance, "lambda": lambdas},
        guardrails=guardrails,
        compute={"backend": "numpy", "method": "stim_pymatching_sampling"},
    )


def score(
    config: dict[str, Any],
    artifacts: list[dict[str, Any]],
    seed: int,
    progress: Callable[[float, str], None] | None = None,
    cancel: threading.Event | None = None,
    stage: str = "full",
    cache_dir: str | None = None,
) -> EvaluationCore:
    """Run guardrails then sampling. ``config`` is normalized and stage-merged."""
    cases = _cases(config, artifacts)
    guardrails, rejection = run_guardrails(build_guardrails(cases, config, stage, cache_dir, cancel))
    if rejection is not None:
        return EvaluationCore(
            status="rejected", guardrails=guardrails, rejection=rejection,
            compute={"backend": "numpy", "method": None},
        )
    per_distance = []
    for index, case in enumerate(cases):
        if progress:
            progress(index / len(cases), f"sampling d={case.distance}")
        per_distance.append(_distance_metrics(case, config, seed, cancel))
    if progress:
        progress(1.0, "done")
    return _scored(per_distance, guardrails)


SPEC = EvaluatorSpec(
    kind=KIND,
    version=VERSION,
    title="QEC memory experiment",
    description=(
        "Evolve a quantum-error-correction memory circuit. The candidate emits a noiseless Stim "
        "circuit; the evaluator applies the noise, decodes with PyMatching and scores the logical "
        "error rate per round, guarding against noise injection, trivial observables and fake distance."
    ),
    task="stim_circuit",
    entry_signature="build(distance: int, rounds: int) -> stim.Circuit",
    objectives=[
        {"key": "logical_error_per_round", "label": "Logical error / round", "direction": "minimize"},
        {"key": "qubits", "label": "Physical qubits", "direction": "minimize", "unit": "qubits"},
    ],
    descriptors=[
        {"key": "qubits", "label": "Qubits", "min": 0, "max": 200, "default_bins": 8},
        {"key": "two_qubit_gates_per_round", "label": "Two-qubit gates / round", "min": 0, "max": 2000, "default_bins": 8},
    ],
    config_schema=CONFIG_SCHEMA,
    default_config=DEFAULT_CONFIG,
    stages=STAGES,
    calls=calls,
    score=score,
    validate_extra=validate_extra,
)
