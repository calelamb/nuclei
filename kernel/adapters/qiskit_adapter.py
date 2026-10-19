import re
from kernel.adapters.base import FrameworkAdapter
from kernel.adapters._math import assign_layer, partial_trace_qubit, step_state_payload
from kernel.adapters._qiskit_aer import (
    has_measurements,
    is_deterministic,
    prepare_for_aer,
    run_on_aer,
)
from kernel.adapters._qiskit_expand import expand_blocks as _expand_blocks
from kernel.adapters._qiskit_params import UNAVAILABLE_LABEL, params_and_symbols as _params_and_symbols
from kernel.adapters.binding import free_parameter_names
from kernel.adapters.errors import UnboundParametersError
from kernel.models.snapshot import CircuitSnapshot, Gate, SimulationResult

# Upper bound on the gates a block-expanded snapshot may hold (R-2).
MAX_EXPANDED_GATES = 2000


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


_PLAIN_NAMES = {"cx": "CNOT", "cz": "CZ", "h": "H", "x": "X", "y": "Y",
                "z": "Z", "s": "S", "t": "T", "rx": "RX", "ry": "RY",
                "rz": "RZ", "swap": "SWAP", "ccx": "Toffoli", "measure": "Measure"}


def _canonical_name(op) -> str:
    mapped = GATE_NAME_MAP.get(type(op).__name__)
    if mapped is not None:
        return mapped
    # Fallback: try mapping by op.name
    return _PLAIN_NAMES.get(op.name.lower(), op.name.upper())


def _split_controls(gate_name: str, qubits: list[int]) -> tuple[list[int], list[int]]:
    """``(controls, targets)`` for the gates whose leading qubits control."""
    if gate_name in ("CNOT", "CZ"):
        return qubits[:1], qubits[1:]
    if gate_name == "Toffoli":
        return qubits[:2], qubits[2:]
    return [], qubits


def _safe_params(op, notes: list[str]) -> tuple[list[float], list[str | None]]:
    try:
        return _params_and_symbols(op)
    except Exception:
        # why: a diagram with one unlabelled gate beats no diagram (R-13)
        notes.append(f"Could not read the parameters of instruction '{op.name}'.")
        return [0.0], [UNAVAILABLE_LABEL]


def _gate_for(instruction, index_of: dict, qubit_layers: dict[int, int], notes: list[str]) -> Gate:
    op = instruction.operation
    qubits = [index_of[q] for q in instruction.qubits]
    gate_name = _canonical_name(op)
    params, symbols = _safe_params(op, notes)
    controls, targets = _split_controls(gate_name, qubits)

    # Greedy layer assignment: place gate in the earliest layer
    # where all involved qubits are free
    layer = assign_layer(qubit_layers, controls + targets)
    return Gate(
        type=gate_name,
        targets=targets,
        controls=controls,
        params=params,
        layer=layer,
        symbols=symbols if any(x is not None for x in symbols) else None,
    )


def _expand(circuit_obj):
    # Looked up at call time so the cap is one module constant.
    return _expand_blocks(circuit_obj, MAX_EXPANDED_GATES)


class QiskitAdapter(FrameworkAdapter):
    def detect(self, code: str) -> bool:
        return bool(re.search(r"from\s+qiskit\s+import|import\s+qiskit", code))

    def find_circuit(self, namespace: dict):
        from qiskit import QuantumCircuit

        circuits = [v for v in namespace.values() if isinstance(v, QuantumCircuit)]
        return circuits[-1] if circuits else None

    def extract_snapshot(self, circuit_obj, *, expand_blocks: bool = False) -> CircuitSnapshot:
        """Gate list without simulating. Total: no instruction can make it raise.

        ``expand_blocks`` (opt-in) draws each composite block (``QFT``,
        ``EfficientSU2``...) as its own definition, one level deep and capped
        at ``MAX_EXPANDED_GATES``; a skipped expansion is explained in ``notes``.
        """
        notes: list[str] = []
        circuit = circuit_obj
        if expand_blocks:
            circuit, notes = _expand(circuit_obj)

        index_of = {qubit: i for i, qubit in enumerate(circuit.qubits)}
        qubit_layers: dict[int, int] = {}
        gates = [
            _gate_for(instruction, index_of, qubit_layers, notes)
            for instruction in circuit.data
        ]
        depth = max(qubit_layers.values()) if qubit_layers else 0

        return CircuitSnapshot(
            framework="qiskit",
            qubit_count=circuit.num_qubits,
            classical_bit_count=circuit.num_clbits,
            depth=depth,
            gates=gates,
            notes=notes,
        )

    def simulate(self, circuit_obj, shots: int, seed: int | None = None) -> SimulationResult:
        """Exact state vector plus, when the circuit measures, sampled counts.

        A circuit with no measurement instruction returns exact probabilities
        and ``measurements == {}`` (``measurements_source == "none"``); no
        ``measure_all`` is ever added. Library blocks are transpiled into
        Aer's basis first (``UnsupportedInstructionError`` names what cannot be).
        """
        import time
        from qiskit_aer import AerSimulator

        unbound = free_parameter_names(circuit_obj)
        if unbound:
            raise UnboundParametersError(unbound)

        start = time.time()

        # AerSimulator's seed_simulator=None (the default) means "unseeded" —
        # passing seed through unconditionally is safe either way. Qiskit Aer
        # always honors an explicit integer seed, so seed_honored tracks
        # only whether one was requested, not whether it "worked".
        seed_honored = True if seed is not None else None
        n_qubits = circuit_obj.num_qubits

        circuit_sv = circuit_obj.copy()
        circuit_sv.remove_final_measurements()
        exact = is_deterministic(circuit_sv)
        sim_sv = AerSimulator(method="statevector", seed_simulator=seed)
        prepared = prepare_for_aer(circuit_sv, sim_sv)
        prepared.save_statevector()
        sv_data = run_on_aer(sim_sv, prepared, 1).get_statevector().data

        state_vector = [{"re": float(c.real), "im": float(c.imag)} for c in sv_data]
        probabilities = {
            format(i, f"0{n_qubits}b"): float(abs(c) ** 2)
            for i, c in enumerate(sv_data)
            if abs(c) ** 2 > 1e-10
        }

        measurements: dict[str, int] = {}
        source = "none"
        if has_measurements(circuit_obj):
            sim_qasm = AerSimulator(seed_simulator=seed)
            counts = run_on_aer(sim_qasm, prepare_for_aer(circuit_obj, sim_qasm), shots).get_counts()
            measurements = {k: int(v) for k, v in counts.items()}
            source = "sampled"

        # Compute Bloch coordinates for single-qubit states
        bloch_coords = []
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
            measurements_source=source,
            probabilities_exact=exact,
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
