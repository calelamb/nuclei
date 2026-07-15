"""Tests for Executor.transpile_explore — the Transpiler Explorer payload.

Unlike the agent-worker `transpile` action (metrics-only, exercised by
test_transpile_preview.py), transpile_explore runs a preset PassManager with a
per-pass callback and returns before/after CircuitSnapshots, metric deltas, and
the passes that changed the circuit. Qiskit-only; qiskit is installed in the
kernel test env.
"""

from kernel.executor import Executor

# A GHZ-style circuit over 4 qubits with only linear connectivity available —
# forces the router to insert SWAPs, so the pass-by-pass data is non-trivial.
GHZ_QISKIT = """from qiskit import QuantumCircuit

qc = QuantumCircuit(4, 4)
qc.h(0)
for i in range(3):
    qc.cx(0, i + 1)
qc.measure(range(4), range(4))
"""

BELL_QISKIT = """from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""

CIRQ = """import cirq

q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1)])
"""

LINEAR_COUPLING = [[0, 1], [1, 2], [2, 3]]


def _explore(code: str, **kwargs: object):
    return Executor().transpile_explore(code, **kwargs)


def test_payload_shape_before_after_metrics_passes_target() -> None:
    payload, _stdout, _stderr, error = _explore(
        BELL_QISKIT, basis_gates=["u", "cx"], optimization_level=1
    )

    assert error is None
    assert payload is not None
    # before/after are full CircuitSnapshot dicts.
    for key in ("before", "after"):
        snap = payload[key]
        assert snap["framework"] == "qiskit"
        assert snap["qubit_count"] == 2
        assert isinstance(snap["gates"], list)

    metrics = payload["metrics"]
    for metric in ("depth", "two_qubit", "gate_count"):
        assert set(metrics[metric]) == {"before", "after"}
        assert isinstance(metrics[metric]["before"], int)
        assert isinstance(metrics[metric]["after"], int)

    assert isinstance(payload["passes"], list)
    assert payload["target"]["basis_gates"] == ["u", "cx"]
    assert payload["target"]["coupling_size"] == 0


def test_coupling_map_forces_routing_swaps_attributed_to_a_pass() -> None:
    payload, _stdout, _stderr, error = _explore(
        GHZ_QISKIT,
        basis_gates=["rz", "sx", "x", "cx"],
        coupling_map=LINEAR_COUPLING,
        optimization_level=1,
    )

    assert error is None
    assert payload is not None
    assert payload["target"]["coupling_size"] == 3

    # Routing on a line topology must add SWAPs vs. the all-to-all original —
    # so the two-qubit count grows, and at least one reported pass added a swap.
    assert payload["metrics"]["two_qubit"]["after"] > payload["metrics"]["two_qubit"]["before"]
    added_swaps = [
        p for p in payload["passes"] if p["added_gates"].get("swap", 0) > 0
    ]
    assert added_swaps, payload["passes"]
    # Every reported pass carries a name, a depth, and a non-empty delta.
    for p in payload["passes"]:
        assert isinstance(p["name"], str) and p["name"]
        assert isinstance(p["depth"], int)
        assert p["added_gates"]


def test_no_coupling_map_reports_zero_coupling_size() -> None:
    payload, _stdout, _stderr, error = _explore(BELL_QISKIT, basis_gates=["u", "cx"])

    assert error is None
    assert payload is not None
    assert payload["target"]["coupling_size"] == 0


def test_non_qiskit_framework_is_rejected() -> None:
    payload, _stdout, _stderr, error = _explore(CIRQ, language="python")

    assert payload is None
    assert error is not None
    assert error.code == "transpile_unsupported_framework"


def test_no_circuit_in_qiskit_code() -> None:
    payload, _stdout, _stderr, error = _explore(
        "from qiskit import QuantumCircuit\nx = 1\n", language="python"
    )

    assert payload is None
    assert error is not None
    assert error.code == "no_circuit"
