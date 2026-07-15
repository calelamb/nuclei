import re
from kernel.adapters.base import FrameworkAdapter
from kernel.adapters._math import assign_layer, partial_trace_qubit, step_state_payload
from kernel.models.snapshot import CircuitSnapshot, SimulationResult, Gate


# Map Qiskit gate class names to canonical names
GATE_NAME_MAP = {
    "HGate": "H",
    "XGate": "X",
    "YGate": "Y",
    "ZGate": "Z",
    "SGate": "S",
    "SdgGate": "Sdg",
    "TGate": "T",
    "TdgGate": "Tdg",
    "RXGate": "RX",
    "RYGate": "RY",
    "RZGate": "RZ",
    "U1Gate": "U1",
    "U2Gate": "U2",
    "U3Gate": "U3",
    "CXGate": "CNOT",
    "CZGate": "CZ",
    "SwapGate": "SWAP",
    "CCXGate": "Toffoli",
    "Measure": "Measure",
}


class QiskitAdapter(FrameworkAdapter):
    def detect(self, code: str) -> bool:
        return bool(re.search(r"from\s+qiskit\s+import|import\s+qiskit", code))

    def find_circuit(self, namespace: dict):
        from qiskit import QuantumCircuit

        circuits = [v for v in namespace.values() if isinstance(v, QuantumCircuit)]
        return circuits[-1] if circuits else None

    def extract_snapshot(self, circuit_obj) -> CircuitSnapshot:
        gates = []
        # Track qubit occupancy for layer assignment
        qubit_layers: dict[int, int] = {}

        for instruction in circuit_obj.data:
            op = instruction.operation
            qubits = [circuit_obj.qubits.index(q) for q in instruction.qubits]

            class_name = type(op).__name__
            gate_name = GATE_NAME_MAP.get(class_name, None)
            if gate_name is None:
                # Fallback: try mapping by op.name
                name_lower = op.name.lower()
                name_map = {"cx": "CNOT", "cz": "CZ", "h": "H", "x": "X", "y": "Y",
                            "z": "Z", "s": "S", "t": "T", "rx": "RX", "ry": "RY",
                            "rz": "RZ", "swap": "SWAP", "ccx": "Toffoli", "measure": "Measure"}
                gate_name = name_map.get(name_lower, op.name.upper())
            params = [float(p) for p in op.params] if op.params else []

            if gate_name in ("CNOT", "CZ"):
                controls = qubits[:1]
                targets = qubits[1:]
            elif gate_name == "Toffoli":
                controls = qubits[:2]
                targets = qubits[2:]
            elif gate_name == "SWAP":
                controls = []
                targets = qubits
            else:
                controls = []
                targets = qubits

            # Greedy layer assignment: place gate in the earliest layer
            # where all involved qubits are free
            layer = assign_layer(qubit_layers, controls + targets)

            gates.append(Gate(
                type=gate_name,
                targets=targets,
                controls=controls,
                params=params,
                layer=layer,
            ))

        depth = max(qubit_layers.values()) if qubit_layers else 0

        return CircuitSnapshot(
            framework="qiskit",
            qubit_count=circuit_obj.num_qubits,
            classical_bit_count=circuit_obj.num_clbits,
            depth=depth,
            gates=gates,
        )

    def simulate(self, circuit_obj, shots: int, seed: int | None = None) -> SimulationResult:
        import time
        from qiskit_aer import AerSimulator

        start = time.time()

        # AerSimulator's seed_simulator=None (the default) means "unseeded" —
        # passing seed through unconditionally is safe either way. Qiskit Aer
        # always honors an explicit integer seed, so seed_honored tracks
        # only whether one was requested, not whether it "worked".
        seed_honored = True if seed is not None else None

        # Get statevector
        sim_sv = AerSimulator(method="statevector", seed_simulator=seed)
        circuit_sv = circuit_obj.copy()
        circuit_sv.remove_final_measurements()
        circuit_sv.save_statevector()
        result_sv = sim_sv.run(circuit_sv, shots=1).result()
        sv = result_sv.get_statevector()
        sv_data = sv.data

        state_vector = [{"re": float(c.real), "im": float(c.imag)} for c in sv_data]
        probabilities = {
            format(i, f"0{circuit_obj.num_qubits}b"): float(abs(c) ** 2)
            for i, c in enumerate(sv_data)
            if abs(c) ** 2 > 1e-10
        }

        # Run sampled measurements
        sim_qasm = AerSimulator(seed_simulator=seed)
        result_qasm = sim_qasm.run(circuit_obj, shots=shots).result()
        counts = result_qasm.get_counts()
        measurements = {k: int(v) for k, v in counts.items()}

        # Compute Bloch coordinates for single-qubit states
        bloch_coords = []
        n_qubits = circuit_obj.num_qubits
        for i in range(n_qubits):
            # Partial trace to get single-qubit density matrix.
            # why: partial_trace_qubit reshapes C-order, so its axis 0 is
            # the MSB of the statevector index. Qiskit statevectors are
            # little-endian (qubit 0 = LSB), so Qiskit qubit i lives on
            # axis n-1-i. The frontend labels bloch_coords[i] as q{i};
            # tracing axis i directly would mirror the qubit order.
            rho = _partial_trace_qubit(sv_data, n_qubits, n_qubits - 1 - i)
            x = 2 * rho[0, 1].real
            y = 2 * rho[0, 1].imag
            z = rho[0, 0].real - rho[1, 1].real
            bloch_coords.append({"x": float(x), "y": float(y), "z": float(z)})

        elapsed = (time.time() - start) * 1000

        return SimulationResult(
            state_vector=state_vector,
            probabilities=probabilities,
            measurements=measurements,
            bloch_coords=bloch_coords,
            execution_time_ms=round(elapsed, 1),
            shot_count=shots,
            seed_honored=seed_honored,
        )


    def state_trace(self, circuit_obj) -> list[dict]:
        """Per-gate state trajectory via incremental Statevector evolution.

        Starts in |0…0⟩ and evolves one instruction at a time (O(G·2ⁿ) total),
        snapshotting probabilities + Bloch after each. Non-unitary ops
        (measure/barrier/reset) leave the state unchanged but still emit a step,
        so step k stays aligned with snapshot.gates[k]. Qiskit is little-endian,
        so the shared Bloch helper is told so.
        """
        from qiskit.quantum_info import Statevector

        n = circuit_obj.num_qubits
        sv = Statevector.from_int(0, 2**n)

        def step(gate_index: int, label: str) -> dict:
            return {"gate_index": gate_index, "label": label, **step_state_payload(sv.data, n, True)}

        steps = [step(-1, "initial")]
        for k, instruction in enumerate(circuit_obj.data):
            op = instruction.operation
            qargs = [circuit_obj.qubits.index(q) for q in instruction.qubits]
            if op.name not in ("measure", "barrier", "reset"):
                try:
                    sv = sv.evolve(op, qargs=qargs)
                except Exception:
                    # A non-unitary or unsupported op leaves the state as-is
                    # rather than aborting the whole trace.
                    pass
            label = f"{op.name} " + ",".join(f"q{q}" for q in qargs)
            steps.append(step(k, label.strip()))
        return steps


# Kept as a module-level alias so existing call sites and imports keep
# working; the implementation now lives in _math.py for reuse.
_partial_trace_qubit = partial_trace_qubit
