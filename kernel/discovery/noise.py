"""Evaluator-applied noise models for QEC memory circuits (PRD 14 spec 6.3).

Candidates emit *noiseless* circuits; the evaluator inserts noise here, on the
flattened circuit (REPEAT/SHIFT_COORDS expanded). Noise never changes the
measurement record, so DETECTOR/OBSERVABLE targets stay valid.

Layers are TICK-delimited. For every layer the following are inserted
(``p`` is the physical error rate, ``eta`` the Z-bias):

``uniform(p)``
    * ``DEPOLARIZE1(p)`` after each one-qubit Clifford,
    * ``DEPOLARIZE2(p)`` after each two-qubit gate (pairs only; classically
      controlled pairs get ``DEPOLARIZE1(p)`` on the quantum qubit),
    * measurement flip *before* each measurement: ``X_ERROR(p)`` for M/MR
      (Z basis), ``Z_ERROR(p)`` for MX/MRX, and ``X_ERROR(p)`` for MY/MRY
      (X anticommutes with Y; a Y_ERROR would be invisible to an MY),
    * reset flip *after* each reset (also the reset half of MR*):
      ``X_ERROR(p)`` for R/RY, ``Z_ERROR(p)`` for RX,
    * ``DEPOLARIZE1(p)`` at the end of a layer, on every circuit qubit not
      touched in that layer, if the layer contains any gate, reset or
      measurement.

``si1000(p)`` (Gidney, Newman, McEwen 2021, superconducting-inspired)
    * one-qubit gates ``DEPOLARIZE1(p/10)``; two-qubit gates ``DEPOLARIZE2(p)``,
    * measurement flip ``5p`` (before the measurement),
    * reset flip ``2p`` (after the reset),
    * idle qubits in a layer without measure/reset: ``DEPOLARIZE1(p/10)``,
    * resonator idle in a layer that contains a measurement or reset:
      ``DEPOLARIZE1(2p)`` on every qubit *not* measured or reset in it.

``biased_z(p, eta)``
    Like ``uniform`` except that every single-qubit depolarizing channel
    (after 1q gates, idle) becomes ``PAULI_CHANNEL_1(px, py, pz)`` with
    ``pz = p*eta/(1+eta)`` and ``px = py = p/(2*(1+eta))`` (total p). A
    two-qubit gate gets ``DEPOLARIZE2(p/10)`` plus the biased single-qubit
    channel on both of its qubits. Measurement and reset flips are unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import stim

MODELS = ("uniform", "si1000", "biased_z")
_ANNOTATIONS = frozenset({"DETECTOR", "OBSERVABLE_INCLUDE", "QUBIT_COORDS", "SHIFT_COORDS", "TICK", "MPAD"})
_MEASURE_BASIS = {"M": "Z", "MZ": "Z", "MR": "Z", "MRZ": "Z", "MX": "X", "MRX": "X", "MY": "Y", "MRY": "Y"}
_RESET_BASIS = {"R": "Z", "RZ": "Z", "MR": "Z", "MRZ": "Z", "RX": "X", "MRX": "X", "RY": "Y", "MRY": "Y"}
_FLIP_FOR_BASIS = {"Z": "X_ERROR", "X": "Z_ERROR", "Y": "X_ERROR"}
MAX_PROBABILITY = 0.5


@dataclass(frozen=True)
class Rates:
    one_qubit: float
    two_qubit: float
    measure_flip: float
    reset_flip: float
    idle: float
    resonator_idle: float | None = None  # si1000 only


def rates_for(model: str, p: float) -> Rates:
    if model == "si1000":
        return Rates(p / 10, p, 5 * p, 2 * p, p / 10, resonator_idle=2 * p)
    if model in ("uniform", "biased_z"):
        two = p / 10 if model == "biased_z" else p
        return Rates(p, two, p, p, p)
    raise ValueError(f"unknown noise model '{model}'")


def _bias_channel(p: float, eta: float) -> tuple[float, float, float]:
    return (p / (2 * (1 + eta)), p / (2 * (1 + eta)), p * eta / (1 + eta))


def _quantum_targets(inst: stim.CircuitInstruction) -> list[int]:
    return [t.value for t in inst.targets_copy() if t.is_qubit_target]


def _split_layers(circuit: stim.Circuit) -> Iterable[list[stim.CircuitInstruction]]:
    layer: list[stim.CircuitInstruction] = []
    for inst in circuit:
        layer.append(inst)
        if inst.name == "TICK":
            yield layer
            layer = []
    if layer:
        yield layer


class _Builder:
    def __init__(self, model: str, p: float, eta: float):
        if not (0 < p <= 0.1):
            raise ValueError("noise p must be in (0, 0.1]")
        self.model = model
        self.rates = rates_for(model, p)
        self.p = p
        self.eta = eta
        for value in (self.rates.measure_flip, self.rates.reset_flip):
            if value > MAX_PROBABILITY:
                raise ValueError("derived flip probability exceeds 0.5")
        self.out = stim.Circuit()

    def single_qubit(self, qubits: list[int], rate: float) -> None:
        if not qubits:
            return
        if self.model == "biased_z":
            self.out.append("PAULI_CHANNEL_1", qubits, _bias_channel(rate, self.eta))
        else:
            self.out.append("DEPOLARIZE1", qubits, rate)

    def single_qubit_gate_noise(self, qubits: list[int]) -> None:
        self.single_qubit(qubits, self.rates.one_qubit)

    def idle_noise(self, qubits: list[int], rate: float) -> None:
        self.single_qubit(qubits, rate)

    def layer(self, ops: list[stim.CircuitInstruction], active: list[int]) -> None:
        touched: set[int] = set()
        measured_or_reset: set[int] = set()
        has_activity = False
        trailing: list[stim.CircuitInstruction] = []
        for inst in ops:
            if inst.name == "TICK":
                trailing.append(inst)
                continue
            if inst.name in _ANNOTATIONS:
                self.out.append(inst)
                continue
            qubits = _quantum_targets(inst)
            data = stim.gate_data(inst.name)
            if data.produces_measurements or data.is_reset:
                has_activity = True
                touched.update(qubits)
                measured_or_reset.update(qubits)
                self.measure_reset(inst, qubits)
            elif data.is_two_qubit_gate and data.is_unitary:
                has_activity = True
                touched.update(qubits)
                self.two_qubit(inst)
            elif data.is_single_qubit_gate and data.is_unitary:
                has_activity = True
                touched.update(qubits)
                self.out.append(inst)
                self.single_qubit_gate_noise(qubits)
            else:
                self.out.append(inst)
        if has_activity:
            self.layer_idle(active, touched, measured_or_reset)
        for inst in trailing:
            self.out.append(inst)

    def layer_idle(self, active: list[int], touched: set[int], measured: set[int]) -> None:
        if self.rates.resonator_idle is not None and measured:
            resting = [q for q in active if q not in measured]
            if resting:
                self.out.append("DEPOLARIZE1", resting, self.rates.resonator_idle)
            return
        idle = [q for q in active if q not in touched]
        if idle:
            self.idle_noise(idle, self.rates.idle)

    def two_qubit(self, inst: stim.CircuitInstruction) -> None:
        self.out.append(inst)
        pairs: list[int] = []
        classical_controlled: list[int] = []
        targets = inst.targets_copy()
        for a, b in zip(targets[0::2], targets[1::2]):
            if a.is_qubit_target and b.is_qubit_target:
                pairs.extend((a.value, b.value))
            else:
                classical_controlled.extend(t.value for t in (a, b) if t.is_qubit_target)
        if pairs:
            self.out.append("DEPOLARIZE2", pairs, self.rates.two_qubit)
            if self.model == "biased_z":
                self.single_qubit(pairs, self.p)
        if classical_controlled:
            self.single_qubit_gate_noise(classical_controlled)

    def measure_reset(self, inst: stim.CircuitInstruction, qubits: list[int]) -> None:
        name = inst.name
        basis_m = _MEASURE_BASIS.get(name)
        basis_r = _RESET_BASIS.get(name)
        if basis_m is None and basis_r is None:  # e.g. MPP / MXX: left noiseless
            self.out.append(inst)
            return
        if basis_m is not None and qubits:
            self.out.append(_FLIP_FOR_BASIS[basis_m], qubits, self.rates.measure_flip)
        self.out.append(inst)
        if basis_r is not None and qubits:
            self.out.append(_FLIP_FOR_BASIS[basis_r], qubits, self.rates.reset_flip)


def _active_qubits(circuit: stim.Circuit) -> list[int]:
    seen: set[int] = set()
    for inst in circuit:
        if inst.name in _ANNOTATIONS:
            continue
        seen.update(_quantum_targets(inst))
    return sorted(seen)


def apply_noise(circuit: stim.Circuit, model: str, p: float, bias: float = 10.0) -> stim.Circuit:
    """Return a new circuit with ``model`` noise inserted into ``circuit.flattened()``."""
    if model not in MODELS:
        raise ValueError(f"unknown noise model '{model}'")
    flat = circuit.flattened()
    builder = _Builder(model, p, bias)
    active = _active_qubits(flat)
    for layer in _split_layers(flat):
        builder.layer(layer, active)
    return builder.out


def uniform(circuit: stim.Circuit, p: float) -> stim.Circuit:
    return apply_noise(circuit, "uniform", p)


def si1000(circuit: stim.Circuit, p: float) -> stim.Circuit:
    return apply_noise(circuit, "si1000", p)


def biased_z(circuit: stim.Circuit, p: float, eta: float = 10.0) -> stim.Circuit:
    return apply_noise(circuit, "biased_z", p, eta)
