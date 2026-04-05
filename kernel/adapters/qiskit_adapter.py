import re
import numpy as np
from kernel.adapters.base import FrameworkAdapter
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
            all_qubits = controls + targets
            layer = max(qubit_layers.get(q, 0) for q in all_qubits) if all_qubits else 0
            for q in all_qubits:
                qubit_layers[q] = layer + 1

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

    def simulate(self, circuit_obj, shots: int) -> SimulationResult:
        import time
        from qiskit_aer import AerSimulator

        start = time.time()

        # Get statevector
        sim_sv = AerSimulator(method="statevector")
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
        sim_qasm = AerSimulator()
        result_qasm = sim_qasm.run(circuit_obj, shots=shots).result()
        counts = result_qasm.get_counts()
        measurements = {k: int(v) for k, v in counts.items()}

        # Compute Bloch coordinates for single-qubit states
        bloch_coords = []
        n_qubits = circuit_obj.num_qubits
        for i in range(n_qubits):
            # Partial trace to get single-qubit density matrix
            rho = _partial_trace_qubit(sv_data, n_qubits, i)
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
        )


def _partial_trace_qubit(statevector, n_qubits: int, qubit: int):
    """Compute the reduced density matrix for a single qubit."""
    sv = np.array(statevector).reshape([2] * n_qubits)
    # Sum over all qubits except the target
    axes_to_trace = [i for i in range(n_qubits) if i != qubit]
    rho = np.tensordot(sv, sv.conj(), axes=(axes_to_trace, axes_to_trace))
    return rho
