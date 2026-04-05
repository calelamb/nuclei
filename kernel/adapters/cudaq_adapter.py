import re
import numpy as np
from kernel.adapters.base import FrameworkAdapter
from kernel.models.snapshot import CircuitSnapshot, SimulationResult, Gate

# CUDA-Q availability flag
try:
    import cudaq
    CUDAQ_AVAILABLE = True
except ImportError:
    CUDAQ_AVAILABLE = False

# Map CUDA-Q gate names to canonical names
GATE_NAME_MAP = {
    "h": "H",
    "x": "X",
    "y": "Y",
    "z": "Z",
    "s": "S",
    "t": "T",
    "rx": "RX",
    "ry": "RY",
    "rz": "RZ",
    "cx": "CNOT",
    "cnot": "CNOT",
    "cz": "CZ",
    "swap": "SWAP",
    "ccx": "Toffoli",
    "mz": "Measure",
}


class CudaqAdapter(FrameworkAdapter):
    def detect(self, code: str) -> bool:
        return bool(re.search(r"import\s+cudaq|from\s+cudaq\s+import|@cudaq\.kernel", code))

    def find_circuit(self, namespace: dict):
        if not CUDAQ_AVAILABLE:
            return None
        # Look for callables decorated with @cudaq.kernel
        for val in reversed(list(namespace.values())):
            if callable(val) and hasattr(val, '__wrapped__') or (
                hasattr(val, '__name__') and
                hasattr(cudaq, 'kernel') and
                str(type(val)).find('cudaq') >= 0
            ):
                return val
        # Fallback: look for any cudaq kernel type
        for val in reversed(list(namespace.values())):
            tname = str(type(val))
            if 'cudaq' in tname and 'kernel' in tname.lower():
                return val
        return None

    def extract_snapshot(self, circuit_obj) -> CircuitSnapshot:
        if not CUDAQ_AVAILABLE:
            return CircuitSnapshot(
                framework="cuda-q",
                qubit_count=0,
                classical_bit_count=0,
                depth=0,
                gates=[],
            )

        # Use CUDA-Q's circuit inspection
        try:
            # Get the kernel's string representation to parse gates
            kernel_str = str(circuit_obj)
            return self._parse_kernel_string(kernel_str)
        except Exception:
            # Fallback: return minimal snapshot
            return CircuitSnapshot(
                framework="cuda-q",
                qubit_count=0,
                classical_bit_count=0,
                depth=0,
                gates=[],
            )

    def _parse_kernel_string(self, kernel_str: str) -> CircuitSnapshot:
        """Parse a CUDA-Q kernel string representation to extract gates."""
        gates = []
        qubit_set: set[int] = set()
        qubit_layers: dict[int, int] = {}
        measure_count = 0

        for line in kernel_str.strip().split('\n'):
            line = line.strip().lower()
            for gate_key, canonical in GATE_NAME_MAP.items():
                if line.startswith(gate_key + '(') or line.startswith(gate_key + ' '):
                    # Extract qubit indices from parenthesized arguments
                    match = re.search(r'\(([^)]*)\)', line)
                    if not match:
                        continue
                    args = match.group(1)
                    nums = [int(x) for x in re.findall(r'\d+', args)]
                    params = [float(x) for x in re.findall(r'[-+]?\d*\.?\d+', args) if '.' in x or 'e' in x.lower()]

                    if canonical == "Measure":
                        targets = nums[:1] if nums else []
                        controls = []
                        measure_count += 1
                    elif canonical in ("CNOT", "CZ"):
                        controls = nums[:1] if len(nums) >= 2 else []
                        targets = nums[1:2] if len(nums) >= 2 else nums
                    elif canonical == "Toffoli":
                        controls = nums[:2] if len(nums) >= 3 else []
                        targets = nums[2:3] if len(nums) >= 3 else nums
                    elif canonical == "SWAP":
                        controls = []
                        targets = nums[:2]
                    elif canonical in ("RX", "RY", "RZ"):
                        targets = nums[:1] if nums else []
                        controls = []
                        # First float arg is the rotation angle
                        params = params[:1]
                    else:
                        controls = []
                        targets = nums[:1] if nums else []

                    all_qubits = controls + targets
                    for q in all_qubits:
                        qubit_set.add(q)
                    layer = max(qubit_layers.get(q, 0) for q in all_qubits) if all_qubits else 0
                    for q in all_qubits:
                        qubit_layers[q] = layer + 1

                    gates.append(Gate(
                        type=canonical,
                        targets=targets,
                        controls=controls,
                        params=params,
                        layer=layer,
                    ))
                    break

        n_qubits = (max(qubit_set) + 1) if qubit_set else 0
        depth = max(qubit_layers.values()) if qubit_layers else 0

        return CircuitSnapshot(
            framework="cuda-q",
            qubit_count=n_qubits,
            classical_bit_count=measure_count,
            depth=depth,
            gates=gates,
        )

    def simulate(self, circuit_obj, shots: int) -> SimulationResult:
        if not CUDAQ_AVAILABLE:
            raise RuntimeError(
                "CUDA-Q is not installed. Install it with: pip install cuda-quantum\n"
                "Note: CUDA-Q requires an NVIDIA GPU and specific system requirements."
            )

        import time
        start = time.time()

        # Sample the kernel
        result = cudaq.sample(circuit_obj, shots_count=shots)

        # Build measurements from counts
        measurements = {}
        for bitstring, count in result.items():
            measurements[bitstring] = count

        # Compute probabilities from counts
        total = sum(measurements.values())
        probabilities = {k: v / total for k, v in measurements.items()} if total > 0 else {}

        # Attempt statevector simulation for Bloch coords
        state_vector = []
        bloch_coords = []
        try:
            sv = cudaq.get_state(circuit_obj)
            n_qubits = int(np.log2(len(sv)))
            sv_data = np.array(sv)
            state_vector = [{"re": float(c.real), "im": float(c.imag)} for c in sv_data]

            for i in range(n_qubits):
                rho = _partial_trace_qubit(sv_data, n_qubits, i)
                x = 2 * rho[0, 1].real
                y = 2 * rho[0, 1].imag
                z = rho[0, 0].real - rho[1, 1].real
                bloch_coords.append({"x": float(x), "y": float(y), "z": float(z)})
        except Exception:
            pass

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
