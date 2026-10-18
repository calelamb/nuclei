"""The ten ``qec_memory`` guardrails, in spec order (6.3).

Each check runs over every requested distance ("case"); the first failing
distance supplies the rejection message. Checks only rely on the artifact text,
never on the candidate's process.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

import stim

from kernel.discovery.distance import DistanceResult, fault_distance
from kernel.discovery.evaluators.guardrails import FAIL, PASS, WARN, Guardrail, across
from kernel.discovery.noise import apply_noise

MAX_EXPANDED_INSTRUCTIONS = 2_000_000
DETERMINISM_SHOTS = 32
DEFERRED_DETAIL = "skipped (deferred to full stage)"
_NOISE_NAMES = frozenset({"E", "ELSE_CORRELATED_ERROR"})


@dataclass
class Case:
    distance: int
    rounds: int
    text: str
    circuit: stim.Circuit | None = None
    noisy: stim.Circuit | None = None
    dem: stim.DetectorErrorModel | None = None
    fault: DistanceResult | None = None

    @property
    def tag(self) -> str:
        return f"d={self.distance}"


def walk(circuit: stim.Circuit) -> Iterator[stim.CircuitInstruction | stim.CircuitRepeatBlock]:
    """All instructions, descending into REPEAT blocks (blocks themselves are yielded too)."""
    for item in circuit:
        yield item
        if isinstance(item, stim.CircuitRepeatBlock):
            yield from walk(item.body_copy())


def expanded_instruction_count(circuit: stim.Circuit) -> int:
    total = 0
    for item in circuit:
        if isinstance(item, stim.CircuitRepeatBlock):
            total += item.repeat_count * max(1, expanded_instruction_count(item.body_copy()))
        else:
            total += 1
    return total


def _short(exc: Exception) -> str:
    return " ".join(str(exc).split())[:300]


def _is_noise(inst: stim.CircuitInstruction) -> bool:
    data = stim.gate_data(inst.name)
    if inst.name in _NOISE_NAMES or inst.name.startswith("HERALDED"):
        return True
    if data.is_noisy_gate and not data.produces_measurements:
        return True
    return data.produces_measurements and bool(inst.gate_args_copy())


def _canonical_gate(name: str) -> str:
    try:
        return stim.gate_data(name).name
    except (ValueError, IndexError):
        return name.upper()


# --- individual checks --------------------------------------------------------


def check_parse(case: Case):
    try:
        case.circuit = stim.Circuit(case.text)
    except Exception as exc:  # noqa: BLE001 - stim raises ValueError, but never trust it
        return FAIL, f"{case.tag}: circuit does not parse: {_short(exc)}"
    return PASS, None


def check_noiseless(case: Case):
    bad = sorted({i.name for i in walk(case.circuit) if isinstance(i, stim.CircuitInstruction) and _is_noise(i)})
    if bad:
        return FAIL, f"{case.tag}: candidate injected noise ({', '.join(bad)}); the evaluator applies all noise."
    return PASS, None


def check_gate_set(case: Case, allowed: set[str]):
    used = set()
    for item in walk(case.circuit):
        used.add("REPEAT" if isinstance(item, stim.CircuitRepeatBlock) else item.name)
    bad = sorted(name for name in used if _canonical_gate(name) not in allowed)
    if bad:
        return FAIL, f"{case.tag}: gate(s) not allowed: {', '.join(bad)}."
    return PASS, None


def check_qubit_budget(case: Case, max_qubits: int):
    if case.circuit.num_qubits > max_qubits:
        return FAIL, f"{case.tag}: {case.circuit.num_qubits} qubits exceeds the budget of {max_qubits}."
    size = expanded_instruction_count(case.circuit)
    if size > MAX_EXPANDED_INSTRUCTIONS:
        return FAIL, f"{case.tag}: circuit expands to {size} instructions (limit {MAX_EXPANDED_INSTRUCTIONS})."
    return PASS, None


def check_has_observable(case: Case):
    if case.circuit.num_observables < 1:
        return FAIL, f"{case.tag}: the circuit declares no OBSERVABLE_INCLUDE."
    counts: dict[int, int] = {i: 0 for i in range(case.circuit.num_observables)}
    for inst in case.circuit.flattened():
        if inst.name == "OBSERVABLE_INCLUDE":
            index = int(inst.gate_args_copy()[0])
            counts[index] = counts.get(index, 0) + sum(1 for t in inst.targets_copy() if t.is_measurement_record_target)
    empty = sorted(i for i, n in counts.items() if n == 0)
    if empty:
        return FAIL, f"{case.tag}: observable(s) {empty} have no measurement targets."
    return PASS, None


def _ensure_noisy(case: Case, noise: dict[str, Any]) -> stim.Circuit:
    if case.noisy is None:
        case.noisy = apply_noise(case.circuit, noise["model"], noise["p"], noise.get("bias", 10.0))
    return case.noisy


def check_deterministic(case: Case, noise: dict[str, Any]):
    try:
        case.circuit.detector_error_model()
        detections, observables = case.circuit.compile_detector_sampler(seed=0).sample(
            DETERMINISM_SHOTS, separate_observables=True
        )
        if detections.any() or observables.any():
            return FAIL, f"{case.tag}: noiseless reference sample is not all zero (non-deterministic detectors/observables)."
        _ensure_noisy(case, noise).detector_error_model()
    except ValueError as exc:
        return FAIL, f"{case.tag}: detectors/observables are not deterministic: {_short(exc)}"
    return PASS, None


def check_duration(case: Case):
    layers = 0
    measuring = False
    for inst in case.circuit.flattened():
        if inst.name == "TICK":
            layers += measuring
            measuring = False
        elif stim.gate_data(inst.name).produces_measurements:
            measuring = True
    layers += measuring
    if layers < case.rounds:
        return FAIL, f"{case.tag}: only {layers} measurement layer(s) between TICKs but {case.rounds} rounds were requested."
    return PASS, None


def check_decodable(case: Case, noise: dict[str, Any]):
    try:
        case.dem = _ensure_noisy(case, noise).detector_error_model(decompose_errors=True)
    except ValueError as exc:
        return FAIL, f"{case.tag}: error model cannot be decomposed into a matchable graph: {_short(exc)}"
    return PASS, None


def check_nontrivial_observable(case: Case):
    for inst in case.dem.flattened():
        if inst.type == "error" and any(t.is_logical_observable_id() for t in inst.targets_copy()):
            return PASS, None
    return FAIL, f"{case.tag}: no error mechanism can flip the logical observable (it is trivial)."


def check_fault_distance(case: Case, noise: dict[str, Any], cache_dir: str | None, cancel):
    result = fault_distance(_ensure_noisy(case, noise), case.distance, cache_dir=cache_dir, cancel_event=cancel)
    case.fault = result
    if result.weight is not None and result.weight < case.distance:
        return FAIL, (
            f"Requested d={case.distance} but an undetectable logical error of weight {result.weight} exists."
        )
    if result.weight is None:
        return WARN, f"{case.tag}: no undetectable logical error found within the search bounds; distance unverified."
    if not result.complete:
        return WARN, f"{case.tag}: distance verified only up to the search bounds."
    return PASS, None


def build_guardrails(
    cases: list[Case], config: dict[str, Any], stage: str, cache_dir: str | None, cancel
) -> list[Guardrail]:
    noise = config["noise"]
    allowed = {_canonical_gate(g) for g in config["allowed_gates"]}
    each = lambda fn: (lambda: across(cases, fn))  # noqa: E731
    return [
        Guardrail("parse", "Candidate output is valid Stim", each(check_parse)),
        Guardrail("noiseless", "Candidate emits noiseless circuits", each(check_noiseless)),
        Guardrail("gate_set", "Only allowed gates are used", each(lambda c: check_gate_set(c, allowed))),
        Guardrail("qubit_budget", "Qubit and size budget respected", each(lambda c: check_qubit_budget(c, config["max_qubits"]))),
        Guardrail("has_observable", "At least one logical observable is defined", each(check_has_observable)),
        Guardrail("deterministic", "Detectors and observables are deterministic", each(lambda c: check_deterministic(c, noise))),
        Guardrail("duration", "Circuit lasts at least the requested rounds", each(check_duration)),
        Guardrail("decodable", "Error model is decodable by matching", each(lambda c: check_decodable(c, noise))),
        Guardrail("nontrivial_observable", "Logical observable can actually be flipped", each(check_nontrivial_observable)),
        Guardrail(
            "fault_distance",
            "Fault distance is at least the requested distance",
            each(lambda c: check_fault_distance(c, noise, cache_dir, cancel)),
            skip_reason=DEFERRED_DETAIL if stage == "screen" else None,
        ),
    ]
