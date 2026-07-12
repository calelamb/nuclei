"""Stim adapter — stabilizer circuits as a kernel framework (PRD 10 D1/D2).

Two entry paths share this adapter:

- **Python mode** (like qiskit/cirq): user code builds `stim.Circuit`
  objects; `find_circuit` picks the last one in the namespace.
- **Source mode** (like Q#): raw `.stim` text arrives with
  `language: "stim"` and goes straight to `stim.Circuit(text)` — never
  through Python `exec`.

Snapshot mapping is **moment-based**, not greedy: Stim circuits are
moment-structured, so `TICK` drives layer assignment (layer = tick index).
Noise instructions map to gates typed `NOISE:<kind>` with the channel
probabilities in `params`; `DETECTOR`/`OBSERVABLE_INCLUDE` become marker
gates so the timeline can render a detector track aligned to ticks.

Simulation is honest about being a stabilizer sampler: `state_vector`,
`probabilities`, and `bloch_coords` are empty — stabilizer circuits
routinely exceed statevector sizes, and the UI swaps in QEC panels instead
(PRD 10 Phase D).
"""

from __future__ import annotations

import re

from kernel.adapters.base import FrameworkAdapter
from kernel.models.errors import KernelError
from kernel.models.snapshot import CircuitSnapshot, Gate, SimulationResult

# Stim instruction name → canonical CircuitSnapshot gate vocabulary. Names
# not listed pass through unchanged (they are already uppercase mnemonics).
GATE_NAME_MAP = {
    "CX": "CNOT",
    "ZCX": "CNOT",
    "CNOT": "CNOT",
    "M": "Measure",
    "MZ": "Measure",
    "MX": "MX",
    "MY": "MY",
    "R": "Reset",
    "RZ": "Reset",
    "S_DAG": "Sdg",
    "SQRT_X": "SX",
}

# Annotations that carry no circuit-diagram content. Coordinates surface
# through the qec_snapshot sidecar instead; TICK is consumed as the moment
# separator before this set is consulted.
_SKIPPED_ANNOTATIONS = frozenset({"QUBIT_COORDS", "SHIFT_COORDS", "TICK"})


class StimAdapter(FrameworkAdapter):
    def detect(self, code: str) -> bool:
        return bool(re.search(r"import\s+stim|from\s+stim\s+import", code))

    def find_circuit(self, namespace: dict):
        import stim

        circuits = [v for v in namespace.values() if isinstance(v, stim.Circuit)]
        return circuits[-1] if circuits else None

    # ───────── snapshot mapping (moment/TICK-based) ─────────

    def extract_snapshot(self, circuit_obj) -> CircuitSnapshot:
        import stim

        gates: list[Gate] = []
        layer = 0
        max_used_layer = -1

        for inst in circuit_obj.flattened():
            name = inst.name
            if name == "TICK":
                layer += 1
                continue
            if name in _SKIPPED_ANNOTATIONS:
                continue

            args = [float(a) for a in inst.gate_args_copy()]

            if name == "DETECTOR":
                # Detector markers anchor to the moment they appear in;
                # params carry the DETECTOR's coordinate arguments so the
                # timeline's detector track can label them.
                gates.append(Gate(type="DETECTOR", targets=[], params=args, layer=layer))
                max_used_layer = max(max_used_layer, layer)
                continue
            if name == "OBSERVABLE_INCLUDE":
                gates.append(Gate(type="OBSERVABLE", targets=[], params=args, layer=layer))
                max_used_layer = max(max_used_layer, layer)
                continue

            data = stim.gate_data(name)
            qubits = [t.value for t in inst.targets_copy() if t.is_qubit_target]

            if data.is_noisy_gate and not data.produces_measurements:
                gate_type = f"NOISE:{name}"
                if data.is_two_qubit_gate:
                    groups = [qubits[i : i + 2] for i in range(0, len(qubits), 2)]
                else:
                    groups = [[q] for q in qubits]
                for group in groups:
                    gates.append(
                        Gate(type=gate_type, targets=group, params=args, layer=layer)
                    )
                max_used_layer = max(max_used_layer, layer)
                continue

            gate_type = GATE_NAME_MAP.get(name, name)
            if data.is_two_qubit_gate:
                # Stim packs repeated applications into one instruction:
                # "CX 0 1 2 3" is CNOT(0→1) then CNOT(2→3). Controlled
                # gates put the control first in each pair.
                for i in range(0, len(qubits) - 1, 2):
                    pair = qubits[i : i + 2]
                    if name in ("CX", "ZCX", "CNOT", "CY", "CZ", "XCX", "XCY", "XCZ", "YCX", "YCY", "YCZ"):
                        controls, targets = pair[:1], pair[1:]
                    else:
                        controls, targets = [], pair
                    gates.append(
                        Gate(type=gate_type, targets=targets, controls=controls, params=args, layer=layer)
                    )
            else:
                for q in qubits:
                    gates.append(Gate(type=gate_type, targets=[q], params=args, layer=layer))
            if qubits:
                max_used_layer = max(max_used_layer, layer)

        return CircuitSnapshot(
            framework="stim",
            qubit_count=circuit_obj.num_qubits,
            classical_bit_count=circuit_obj.num_measurements,
            depth=max_used_layer + 1,
            gates=gates,
        )

    # ───────── simulation (sampler, honest stabilizer output) ─────────

    def simulate(self, circuit_obj, shots: int, seed: int | None = None) -> SimulationResult:
        import time

        start = time.time()

        # stim's compiled sampler always honors an explicit integer seed
        # (same seed + same stim version → identical samples), so like the
        # qiskit adapter, seed_honored tracks whether one was requested.
        sampler = circuit_obj.compile_sampler(seed=seed)
        samples = sampler.sample(shots)

        # Histogram of measurement-record bitstrings. Convention matches
        # the qiskit adapter's key order: the FIRST recorded measurement is
        # the RIGHTMOST character (little-endian, qiskit's c0-on-the-right).
        measurements: dict[str, int] = {}
        for row in samples:
            key = "".join("1" if bit else "0" for bit in reversed(row))
            measurements[key] = measurements.get(key, 0) + 1

        elapsed = (time.time() - start) * 1000

        return SimulationResult(
            state_vector=[],
            probabilities={},
            measurements=measurements,
            bloch_coords=[],
            execution_time_ms=round(elapsed, 1),
            shot_count=shots,
            seed_honored=True if seed is not None else None,
        )

    # ───────── source mode (raw .stim text, never exec'd) ─────────

    def build_from_source(self, code: str):
        """Parse raw .stim text into a stim.Circuit.

        Raises KernelError-compatible ValueError from stim on bad syntax;
        callers go through parse_source/execute_source which translate it.
        """
        import stim

        return stim.Circuit(code)

    def _compile_error(self, exc: Exception) -> KernelError:
        return KernelError(
            code="compile_error",
            message=str(exc).strip().splitlines()[0] if str(exc).strip() else "Invalid Stim circuit.",
            framework="stim",
        )

    def parse_source(
        self, code: str
    ) -> tuple[CircuitSnapshot | None, str, str, KernelError | None]:
        try:
            circuit = self.build_from_source(code)
        except ValueError as exc:
            return None, "", "", self._compile_error(exc)
        # Stash for the executor's qec_snapshot cache (see Executor.parse).
        self.last_circuit = circuit
        return self.extract_snapshot(circuit), "", "", None

    def execute_source(
        self,
        code: str,
        shots: int,
        *,
        params: dict[str, float] | None = None,
        seed: int | None = None,
    ) -> tuple[
        SimulationResult | None, CircuitSnapshot | None, str, str, KernelError | None
    ]:
        if params:
            # Raw .stim text has no parameters to bind — reject loudly
            # rather than silently ignoring a sweep's params (a swept stim
            # experiment must use a Python entry that builds circuits).
            return None, None, "", "", KernelError(
                code="compile_error",
                message=(
                    "Raw .stim circuits take no parameters — remove `params` "
                    "or generate the circuit from Python code instead."
                ),
                framework="stim",
            )
        try:
            circuit = self.build_from_source(code)
        except ValueError as exc:
            return None, None, "", "", self._compile_error(exc)
        self.last_circuit = circuit
        snapshot = self.extract_snapshot(circuit)
        result = self.simulate(circuit, shots, seed=seed)
        return result, snapshot, "", "", None
