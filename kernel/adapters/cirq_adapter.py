import re
import numpy as np
import cirq
from kernel.adapters.base import FrameworkAdapter
from kernel.models.snapshot import CircuitSnapshot, SimulationResult, Gate


# Map Cirq gate types to canonical names
def _gate_name(gate) -> str:
    if isinstance(gate, cirq.HPowGate) and gate.exponent == 1:
        return "H"
    if isinstance(gate, cirq.XPowGate) and gate.exponent == 1:
        return "X"
    if isinstance(gate, cirq.YPowGate) and gate.exponent == 1:
        return "Y"
    if isinstance(gate, cirq.ZPowGate) and gate.exponent == 1:
        return "Z"
    if isinstance(gate, cirq.ZPowGate) and gate.exponent == 0.5:
        return "S"
    if isinstance(gate, cirq.ZPowGate) and gate.exponent == 0.25:
        return "T"
    if isinstance(gate, (cirq.XPowGate, cirq.YPowGate, cirq.ZPowGate)):
        base = type(gate).__name__[0]  # X, Y, or Z
        return f"R{base}"
    if isinstance(gate, cirq.CNotPowGate) and gate.exponent == 1:
        return "CNOT"
    if isinstance(gate, cirq.CZPowGate) and gate.exponent == 1:
        return "CZ"
    if isinstance(gate, cirq.SwapPowGate) and gate.exponent == 1:
        return "SWAP"
    if isinstance(gate, cirq.CCXPowGate) and gate.exponent == 1:
        return "Toffoli"
    if isinstance(gate, cirq.MeasurementGate):
        return "Measure"
    return str(gate).upper()


class CirqAdapter(FrameworkAdapter):
    def detect(self, code: str) -> bool:
        return bool(re.search(r"import\s+cirq|from\s+cirq\s+import", code))

    def find_circuit(self, namespace: dict):
        circuits = [v for v in namespace.values() if isinstance(v, cirq.Circuit)]
        return circuits[-1] if circuits else None

    def extract_snapshot(self, circuit_obj: cirq.Circuit) -> CircuitSnapshot:
        all_qubits = sorted(circuit_obj.all_qubits())
        qubit_index = {q: i for i, q in enumerate(all_qubits)}

        gates = []
        for moment_idx, moment in enumerate(circuit_obj.moments):
            for op in moment.operations:
                gate = op.gate
                qubits = [qubit_index[q] for q in op.qubits]
                gate_name = _gate_name(gate)

                params = []
                if hasattr(gate, "exponent") and not isinstance(gate, cirq.MeasurementGate):
                    exp = gate.exponent
                    if isinstance(exp, (int, float)) and exp not in (0, 1):
                        params = [float(exp) * np.pi]

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

                gates.append(Gate(
                    type=gate_name,
                    targets=targets,
                    controls=controls,
                    params=params,
                    layer=moment_idx,
                ))

        n_qubits = len(all_qubits)
        n_classical = sum(
            1 for op in circuit_obj.all_operations()
            if isinstance(op.gate, cirq.MeasurementGate)
        )
        depth = len(circuit_obj.moments)

        return CircuitSnapshot(
            framework="cirq",
            qubit_count=n_qubits,
            classical_bit_count=n_classical,
            depth=depth,
            gates=gates,
        )

    def simulate(self, circuit_obj: cirq.Circuit, shots: int) -> SimulationResult:
        import time

        start = time.time()
        all_qubits = sorted(circuit_obj.all_qubits())
        n_qubits = len(all_qubits)

        # Strip measurements for statevector
        circuit_no_meas = cirq.Circuit(
            op for moment in circuit_obj.moments for op in moment.operations
            if not isinstance(op.gate, cirq.MeasurementGate)
        )

        # Statevector simulation
        sim = cirq.Simulator()
        result_sv = sim.simulate(circuit_no_meas, qubit_order=all_qubits)
        sv_data = result_sv.final_state_vector

        state_vector = [{"re": float(c.real), "im": float(c.imag)} for c in sv_data]
        probabilities = {
            format(i, f"0{n_qubits}b"): float(abs(c) ** 2)
            for i, c in enumerate(sv_data)
            if abs(c) ** 2 > 1e-10
        }

        # Sampled measurements
        result_meas = sim.run(circuit_obj, repetitions=shots)
        measurements: dict[str, int] = {}
        # Combine all measurement keys into bitstrings
        if result_meas.measurements:
            keys = sorted(result_meas.measurements.keys())
            arrays = [result_meas.measurements[k] for k in keys]
            combined = np.concatenate(arrays, axis=1)
            for row in combined:
                bitstring = "".join(str(b) for b in row)
                measurements[bitstring] = measurements.get(bitstring, 0) + 1

        # Bloch coordinates
        bloch_coords = []
        for i in range(n_qubits):
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
    axes_to_trace = [i for i in range(n_qubits) if i != qubit]
    rho = np.tensordot(sv, sv.conj(), axes=(axes_to_trace, axes_to_trace))
    return rho
