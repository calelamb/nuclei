"""Worked example for /docs/extending/framework-adapters/ — a complete
exec-mode adapter for a fake micro-framework called `toyq`.

In a real integration `toyq` would be a pip package and the adapter would
live at kernel/adapters/toyq_adapter.py. Both halves share this one file so
the docs can embed it verbatim and kernel/tests/test_docs_examples.py can
run it unchanged against the real Executor — the example cannot rot.
"""

import re
import time

from kernel.adapters._math import assign_layer
from kernel.adapters.base import FrameworkAdapter
from kernel.executor import AdapterSpec
from kernel.models.snapshot import CircuitSnapshot, Gate, SimulationResult


# ── The fake micro-framework (stands in for the real package) ────────────
class ToyCircuit:
    """What a user of the imaginary `toyq` framework builds."""

    def __init__(self, qubits: int):
        self.qubits = qubits
        # (canonical gate name, control qubits, target qubits)
        self.ops: list[tuple[str, list[int], list[int]]] = []

    def h(self, q: int) -> None:
        self.ops.append(("H", [], [q]))

    def cx(self, control: int, target: int) -> None:
        self.ops.append(("CNOT", [control], [target]))

    def measure_all(self) -> None:
        for q in range(self.qubits):
            self.ops.append(("Measure", [], [q]))


# The exact user code the docs walk through; the test executes this string.
TOY_SNIPPET = """\
import toyq

c = toyq.ToyCircuit(2)
c.h(0)
c.cx(0, 1)
c.measure_all()
"""


# ── The adapter ──────────────────────────────────────────────────────────
class ToyAdapter(FrameworkAdapter):
    def detect(self, code: str) -> bool:
        return bool(re.search(r"import\s+toyq|from\s+toyq\s+import", code))

    def find_circuit(self, namespace: dict):
        # Scan the exec() namespace for circuit objects; newest wins,
        # matching how the Qiskit adapter behaves when students iterate.
        circuits = [v for v in namespace.values() if isinstance(v, ToyCircuit)]
        return circuits[-1] if circuits else None

    def extract_snapshot(self, circuit_obj: ToyCircuit) -> CircuitSnapshot:
        # assign_layer gives every framework identical greedy layering, so
        # toy circuits lay out in the renderer exactly like Qiskit ones.
        qubit_layers: dict[int, int] = {}
        gates = [
            Gate(
                type=name,
                targets=targets,
                controls=controls,
                params=[],
                layer=assign_layer(qubit_layers, controls + targets),
            )
            for name, controls, targets in circuit_obj.ops
        ]
        return CircuitSnapshot(
            framework="toy",
            qubit_count=circuit_obj.qubits,
            classical_bit_count=circuit_obj.qubits,
            depth=max(qubit_layers.values()) if qubit_layers else 0,
            gates=gates,
        )

    def simulate(
        self, circuit_obj: ToyCircuit, shots: int, seed: int | None = None
    ) -> SimulationResult:
        # toyq's "simulator" is deliberately fake: every circuit collapses
        # to |0...0⟩ regardless of seed. A real adapter would seed its
        # backend here and set SimulationResult.seed_honored accordingly.
        start = time.time()
        zeros = "0" * circuit_obj.qubits
        return SimulationResult(
            state_vector=[{"re": 1.0, "im": 0.0}]
            + [{"re": 0.0, "im": 0.0}] * (2**circuit_obj.qubits - 1),
            probabilities={zeros: 1.0},
            measurements={zeros: shots},
            bloch_coords=[{"x": 0.0, "y": 0.0, "z": 1.0}] * circuit_obj.qubits,
            execution_time_ms=round((time.time() - start) * 1000, 1),
            shot_count=shots,
        )


# ── Registration ─────────────────────────────────────────────────────────
# Real adapters add an entry like this to ADAPTER_SPECS in kernel/executor.py.
# Ordering matters: insert BEFORE any spec whose regex could also match your
# code (Q# sits first for exactly that reason).
TOY_SPEC = AdapterSpec(
    framework="toy",
    module="toyq",  # in-tree adapters use "kernel.adapters.<name>_adapter"
    class_name="ToyAdapter",
    detect_pattern=re.compile(r"import\s+toyq|from\s+toyq\s+import"),
    dependencies=("toyq",),
)
