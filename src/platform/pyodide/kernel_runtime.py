"""Browser kernel logic: parse / execute / run_python for the Pyodide worker.

Loaded once into the Pyodide worker's globals. Each entry point takes plain
arguments and returns a JSON string so the main thread never sees Python
objects. Result shapes mirror what the desktop kernel's adapters produce
(kernel/adapters/*_adapter.py, kernel/executor.py) so the UI is framework
agnostic. Also unit-tested under plain CPython (kernel/tests).
"""

import difflib
import io
import json
import re
import sys
import time
import traceback

import numpy as np

# The file name a traceback shows when the caller does not say which tab is running.
DEFAULT_USER_FILENAME = "untitled.py"
_MAX_FILENAME_LEN = 120

# Top-level packages a student plausibly mistypes (the browser build ships these or tells them to use the app).
_KNOWN_PACKAGES = ("qiskit", "qiskit_aer", "cirq", "numpy", "scipy", "matplotlib", "pennylane", "qutip")


def _display_filename(name):
    """The name user code is compiled under: the running tab's file name, never the internal '<string>'."""
    if not isinstance(name, str):
        return DEFAULT_USER_FILENAME
    cleaned = re.sub(r"[\x00-\x1f\"]", "", name).strip()[:_MAX_FILENAME_LEN]
    return cleaned or DEFAULT_USER_FILENAME

# Qiskit class names -> canonical gate names (mirrors kernel/adapters/qiskit_adapter.py).
# Real Qiskit's fixed gates are "singleton" classes (_SingletonHGate, ...) that miss
# this table and are named from op.name below, so only the parametrised gates map here.
_QISKIT_GATE_NAMES = {
    "RXGate": "RX", "RYGate": "RY", "RZGate": "RZ", "U1Gate": "U1", "U2Gate": "U2",
    "U3Gate": "U3", "Measure": "Measure",
}
_QISKIT_FALLBACK_NAMES = {
    "cx": "CNOT", "cz": "CZ", "h": "H", "x": "X", "y": "Y", "z": "Z", "s": "S",
    "t": "T", "rx": "RX", "ry": "RY", "rz": "RZ", "swap": "SWAP", "ccx": "Toffoli",
    "measure": "Measure",
}


# --------------------------------------------------------------------------
# Running user code
# --------------------------------------------------------------------------
_SHIM_PATH_RE = re.compile(r" \((?:unknown location|[^()\n]*/shim/[^()\n]*)\)")


def _module_suggestion(exc):
    """' Did you mean: 'qiskit'?' for a mistyped top-level package, else ''.

    Python only suggests names for attributes and variables; `import qiskitt` gets nothing.
    """
    name = getattr(exc, "name", None)
    if not isinstance(exc, ModuleNotFoundError) or not name or "." in name or name in _KNOWN_PACKAGES:
        return ""
    close = difflib.get_close_matches(name, _KNOWN_PACKAGES, n=1, cutoff=0.8)
    return f". Did you mean: '{close[0]}'?" if close else ""


def _format_error(exc, filename=DEFAULT_USER_FILENAME):
    """Traceback limited to the user's own frames plus the final error line."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == filename]
    lines = []
    if frames:
        lines.append("Traceback (most recent call last):")
        lines.extend(
            f'  File "{filename}", line {f.lineno}, in {f.name}' for f in frames
        )
    lines.extend(part.rstrip("\n") for part in traceback.format_exception_only(type(exc), exc))
    if "Did you mean" not in lines[-1]:
        lines[-1] += _module_suggestion(exc)
    # The shim's module name is an implementation detail, never a student's concern.
    text = "\n".join(lines).replace("_nuclei_unsupported.", "")
    # Same for the shim's install path, e.g. "(/opt/nuclei/shim/qiskit/__init__.py)".
    return _SHIM_PATH_RE.sub("", text)


_output_sink = None


def set_output_sink(sink):
    """Register `sink(line)` (the worker's live-output hook); None turns streaming off."""
    global _output_sink
    _output_sink = sink


class _LiveBuffer(io.StringIO):
    """Collects stdout and hands each complete line to `sink` as it is written.

    `sink` is optional. If it ever raises, streaming stops for this run and the
    caller falls back to returning the whole text, so nothing printed is lost.
    """

    def __init__(self, sink=None):
        super().__init__()
        self._sink = sink
        self._pending = ""
        self.streamed = sink is not None

    def _emit(self, line):
        if self._sink is None:
            return
        try:
            self._sink(line)
        except Exception:
            self._sink = None
            self.streamed = False

    def write(self, text):
        written = super().write(text)
        if self._sink is not None:
            *lines, self._pending = (self._pending + text).split("\n")
            for line in lines:
                self._emit(line)
        return written

    def finish(self):
        """Flush a trailing line that never got its newline."""
        if self._pending:
            self._emit(self._pending)
            self._pending = ""


def _run_user_code(code, metrics=None, stream=False, filename=None):
    """Exec `code` in a fresh namespace. Returns (namespace, stdout, error_text|None).

    With `stream=True` and a registered sink, output is delivered line by line
    while the program runs and the returned stdout is "" (it was already shown).
    """
    metrics = metrics if metrics is not None else {}
    filename = _display_filename(filename)

    def record_metric(name, value):
        metrics[str(name)] = float(value)

    namespace = {"__builtins__": __builtins__, "__name__": "__main__", "record_metric": record_metric}
    buffer = _LiveBuffer(_output_sink if stream else None)
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = buffer
    error = None
    try:
        exec(compile(code, filename, "exec"), namespace)
    except BaseException as exc:  # SystemExit from exit() must not kill the worker
        error = _format_error(exc, filename)
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    buffer.finish()
    return namespace, ("" if buffer.streamed else buffer.getvalue()), error


# --------------------------------------------------------------------------
# Circuit discovery + snapshots
# --------------------------------------------------------------------------
def _find_circuit(namespace):
    """Last circuit object in the namespace, for any framework the user imported."""
    qiskit = sys.modules.get("qiskit")
    cirq = sys.modules.get("cirq")
    found = (None, None)
    for value in namespace.values():
        if qiskit is not None and isinstance(value, getattr(qiskit, "QuantumCircuit", ())):
            found = ("qiskit", value)
        elif cirq is not None and isinstance(value, cirq.Circuit):
            found = ("cirq", value)
    return found


def _assign_layer(qubit_layers, qubits):
    layer = max((qubit_layers.get(q, 0) for q in qubits), default=0)
    for q in qubits:
        qubit_layers[q] = layer + 1
    return layer


def _qiskit_snapshot(circuit):
    gates, qubit_layers = [], {}
    for inst in circuit.data:
        op = inst.operation
        qubits = [circuit.find_bit(q).index for q in inst.qubits]
        gate_name = _QISKIT_GATE_NAMES.get(type(op).__name__)
        if gate_name is None:
            gate_name = _QISKIT_FALLBACK_NAMES.get(op.name.lower(), op.name.upper())
        params = [float(p) for p in op.params] if op.params else []
        if gate_name in ("CNOT", "CZ"):
            controls, targets = qubits[:1], qubits[1:]
        elif gate_name == "Toffoli":
            controls, targets = qubits[:2], qubits[2:]
        else:
            controls, targets = [], qubits
        layer = _assign_layer(qubit_layers, controls + targets)
        gates.append({"type": gate_name, "targets": targets, "controls": controls,
                      "params": params, "layer": layer})
    return {
        "framework": "qiskit",
        "qubit_count": circuit.num_qubits,
        "classical_bit_count": circuit.num_clbits,
        "depth": max(qubit_layers.values()) if qubit_layers else 0,
        "gates": gates,
    }


def _cirq_gate_name(cirq, gate):
    if isinstance(gate, cirq.MeasurementGate):
        return "Measure"
    if isinstance(gate, cirq.HPowGate) and gate.exponent == 1:
        return "H"
    if isinstance(gate, cirq.CNotPowGate) and gate.exponent == 1:
        return "CNOT"
    if isinstance(gate, cirq.XPowGate) and gate.exponent == 1:
        return "X"
    if isinstance(gate, cirq.ZPowGate) and gate.exponent == 1:
        return "Z"
    return str(type(gate).__name__).replace("PowGate", "")


def _cirq_snapshot(circuit):
    import cirq

    all_qubits = sorted(circuit.all_qubits())
    qubit_index = {q: i for i, q in enumerate(all_qubits)}
    gates = []
    for moment_idx, moment in enumerate(circuit.moments):
        for op in moment.operations:
            qubits = [qubit_index[q] for q in op.qubits]
            name = _cirq_gate_name(cirq, op.gate)
            if name == "Measure":
                # One Measure per measured qubit, so the diagram draws a box on every wire.
                gates.extend(
                    {"type": "Measure", "targets": [q], "controls": [], "params": [], "layer": moment_idx}
                    for q in qubits
                )
                continue
            two_qubit = name in ("CNOT", "CZ")
            gates.append({
                "type": name,
                "targets": qubits[1:] if two_qubit else qubits,
                "controls": qubits[:1] if two_qubit else [],
                "params": [],
                "layer": moment_idx,
            })
    return {
        "framework": "cirq",
        "qubit_count": len(all_qubits),
        "classical_bit_count": sum(len(op.qubits) for op in circuit.all_operations() if isinstance(op.gate, cirq.MeasurementGate)),
        "depth": len(circuit.moments),
        "gates": gates,
    }


def _snapshot(framework, circuit):
    return _qiskit_snapshot(circuit) if framework == "qiskit" else _cirq_snapshot(circuit)


# --------------------------------------------------------------------------
# Simulation
# --------------------------------------------------------------------------
def _bloch_from_statevector(sv, n_qubits, little_endian):
    coords = []
    tensor = np.asarray(sv).reshape([2] * n_qubits) if n_qubits else None
    for i in range(n_qubits):
        axis = (n_qubits - 1 - i) if little_endian else i
        others = [j for j in range(n_qubits) if j != axis]
        rho = np.tensordot(tensor, tensor.conj(), axes=(others, others))
        coords.append({
            "x": float(2 * rho[0, 1].real),
            "y": float(2 * rho[0, 1].imag),
            "z": float(rho[0, 0].real - rho[1, 1].real),
        })
    return coords


def _result_payload(sv, n_qubits, measurements, shots, little_endian, metrics):
    return {
        "state_vector": [{"re": float(c.real), "im": float(c.imag)} for c in sv],
        "probabilities": {
            format(i, f"0{n_qubits}b"): float(abs(c) ** 2)
            for i, c in enumerate(sv) if abs(c) ** 2 > 1e-10
        },
        "measurements": measurements,
        "bloch_coords": _bloch_from_statevector(sv, n_qubits, little_endian),
        "execution_time_ms": 0,
        "shot_count": shots,
        "metrics": dict(metrics),
    }


def _simulate_qiskit(circuit, shots, seed, metrics):
    from qiskit import _simulate as sim

    if sim.is_unitary_with_final_measurements(circuit):
        sv = sim.statevector(circuit.remove_final_measurements(inplace=False))
    else:  # mid-circuit measurement / reset / classical control: no single pre-measurement state
        sv = sim.trajectory_state(circuit, seed)
    raw = sim.run_counts(circuit, shots, seed)
    measurements = {sim.format_key(v, circuit): int(n) for v, n in raw.items()}
    return _result_payload(sv, circuit.num_qubits, measurements, shots, True, metrics)


def _simulate_cirq(circuit, shots, seed, metrics):
    import cirq

    all_qubits = sorted(circuit.all_qubits())
    n_qubits = len(all_qubits)
    without_measure = cirq.Circuit(
        op for moment in circuit.moments for op in moment.operations
        if not isinstance(op.gate, cirq.MeasurementGate)
    )
    simulator = cirq.Simulator(seed=seed)
    sv = simulator.simulate(without_measure, qubit_order=all_qubits).final_state_vector
    measurements = {}
    # sim.run() raises on circuits without measurements; sampling only makes
    # sense when there is something to measure.
    if circuit.has_measurements():
        sampled = simulator.run(circuit, repetitions=shots)
        keys = sorted(sampled.measurements.keys())
        combined = np.concatenate([sampled.measurements[k] for k in keys], axis=1)
        for row in combined:
            bits = "".join(str(int(b)) for b in row)
            measurements[bits] = measurements.get(bits, 0) + 1
    return _result_payload(sv, n_qubits, measurements, shots, False, metrics)


def _simulate(framework, circuit, shots, seed, metrics):
    if framework == "qiskit":
        return _simulate_qiskit(circuit, shots, seed, metrics)
    return _simulate_cirq(circuit, shots, seed, metrics)


# --------------------------------------------------------------------------
# Entry points (called from the worker; return JSON strings)
# --------------------------------------------------------------------------
def nuclei_parse(code, filename=None):
    """Run `code` and extract the circuit snapshot. stdout is parse-phase output."""
    namespace, output, error = _run_user_code(code, filename=filename)
    snapshot = None
    if error is None:
        framework, circuit = _find_circuit(namespace)
        if circuit is not None:
            try:
                snapshot = _snapshot(framework, circuit)
            except Exception as exc:  # a snapshot failure must not look like a user error
                error = _format_error(exc, _display_filename(filename))
    return json.dumps({"snapshot": snapshot, "output": output, "error": error})


def nuclei_execute(code, shots, seed=None, filename=None):
    metrics = {}
    start = time.time()
    namespace, output, error = _run_user_code(code, metrics, stream=True, filename=filename)
    if error is not None:
        return json.dumps({"result": None, "snapshot": None, "output": output, "error": error})
    framework, circuit = _find_circuit(namespace)
    if circuit is None:
        return json.dumps({"result": None, "snapshot": None, "output": output, "error": "No circuit found."})
    try:
        result = _simulate(framework, circuit, int(shots), seed, metrics)
        result["execution_time_ms"] = round((time.time() - start) * 1000, 1)
        snapshot = _snapshot(framework, circuit)
    except Exception as exc:
        return json.dumps({"result": None, "snapshot": None, "output": output, "error": _format_error(exc, _display_filename(filename))})
    return json.dumps({"result": result, "snapshot": snapshot, "output": output, "error": None})


def nuclei_run_python(code, filename=None):
    _namespace, output, error = _run_user_code(code, stream=True, filename=filename)
    return json.dumps({"output": output, "error": error})
