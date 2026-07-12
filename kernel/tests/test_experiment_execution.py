"""Tests for PRD 09 Phase B — kernel parameter injection, seeding,
`record_metric`, Q# parameter binding, and honest `seed_honored` reporting
(protocol v1.1, additive over v1).

Covers B7's checklist:
- Determinism: same seed twice -> identical `measurements` (qiskit + cirq);
  different seeds -> different (statistically; rare coincidence tolerated).
- `params` is `{}` in a casual run (no params sent); `params["theta"]`
  reachable when sent.
- `record_metric` capture appears in `result.metrics`.
- Q# parameter binding: successful match (Double formatted with a dot),
  missing/extra/unsupported-type -> `compile_error`.
- `seed_honored` false path via a monkeypatched adapter.
"""

from __future__ import annotations

import re
from types import SimpleNamespace

import pytest

from kernel.adapters.qsharp_adapter import QsharpAdapter
from kernel.executor import AdapterSpec, Executor
from kernel.models import CircuitSnapshot, Gate, SimulationResult

QISKIT_BELL = """\
from qiskit import QuantumCircuit

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
"""

CIRQ_BELL = """\
import cirq

q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.CNOT(q0, q1),
    cirq.measure(q0, q1, key="result"),
])
"""

QSHARP_ROTATE = """\
operation Rotate(theta : Double, layers : Int) : Result {
    use q = Qubit();
    for _ in 1..layers {
        Rx(theta, q);
    }
    let r = M(q);
    Reset(q);
    return r;
}
"""


# ───────── determinism: same seed twice, different seeds usually differ ─────────


def test_qiskit_same_seed_twice_yields_identical_measurements():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")

    runs = []
    for _ in range(2):
        executor = Executor()
        result, _snapshot, _stdout, _stderr, error = executor.execute(
            QISKIT_BELL, 256, language="python", seed=4242
        )
        assert error is None
        runs.append(result.measurements)

    assert runs[0] == runs[1]


def test_qiskit_different_seeds_usually_yield_different_measurements():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")

    result_a, *_ = Executor().execute(QISKIT_BELL, 512, language="python", seed=1)
    result_b, *_ = Executor().execute(QISKIT_BELL, 512, language="python", seed=2)

    # Statistically near-certain to differ over 512 shots of a 2-outcome
    # distribution; an exact coincidental match is possible but exceedingly
    # rare (PRD 09 B7: "tolerate rare coincidence").
    assert result_a.measurements != result_b.measurements


def test_cirq_same_seed_twice_yields_identical_measurements():
    pytest.importorskip("cirq")

    runs = []
    for _ in range(2):
        executor = Executor()
        result, _snapshot, _stdout, _stderr, error = executor.execute(
            CIRQ_BELL, 256, language="python", seed=4242
        )
        assert error is None
        runs.append(result.measurements)

    assert runs[0] == runs[1]


def test_cirq_different_seeds_usually_yield_different_measurements():
    pytest.importorskip("cirq")

    result_a, *_ = Executor().execute(CIRQ_BELL, 512, language="python", seed=1)
    result_b, *_ = Executor().execute(CIRQ_BELL, 512, language="python", seed=2)

    assert result_a.measurements != result_b.measurements


# ───────── params injection ─────────


def test_params_defaults_to_empty_dict_for_casual_run():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")

    code = (
        "from qiskit import QuantumCircuit\n"
        "print(sorted(params.items()))\n"
        "qc = QuantumCircuit(1, 1)\n"
        "qc.h(0)\n"
        "qc.measure(0, 0)\n"
    )
    executor = Executor()
    result, _snapshot, stdout, _stderr, error = executor.execute(
        code, 32, language="python"
    )

    assert error is None
    assert result is not None
    assert stdout.strip() == "[]"


def test_params_reachable_by_name_when_supplied():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")

    code = (
        "from qiskit import QuantumCircuit\n"
        'theta = params["theta"]\n'
        "print(theta)\n"
        "qc = QuantumCircuit(1, 1)\n"
        "qc.rx(theta, 0)\n"
        "qc.measure(0, 0)\n"
    )
    executor = Executor()
    result, _snapshot, stdout, _stderr, error = executor.execute(
        code, 32, language="python", params={"theta": 1.5707963267948966}
    )

    assert error is None
    assert result is not None
    assert stdout.strip() == "1.5707963267948966"


# ───────── record_metric ─────────


def test_record_metric_is_captured_in_result_metrics():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")

    code = (
        "from qiskit import QuantumCircuit\n"
        'record_metric("energy", -1.1372)\n'
        'record_metric("energy", -0.9)\n'  # last write wins, documented
        'record_metric("iterations", 3)\n'
        "qc = QuantumCircuit(1, 1)\n"
        "qc.h(0)\n"
        "qc.measure(0, 0)\n"
    )
    executor = Executor()
    result, _snapshot, _stdout, _stderr, error = executor.execute(
        code, 16, language="python"
    )

    assert error is None
    assert result is not None
    assert result.metrics == {"energy": -0.9, "iterations": 3.0}


def test_metrics_defaults_to_empty_dict_when_nothing_recorded():
    pytest.importorskip("qiskit")
    pytest.importorskip("qiskit_aer")

    code = (
        "from qiskit import QuantumCircuit\n"
        "qc = QuantumCircuit(1, 1)\n"
        "qc.h(0)\n"
        "qc.measure(0, 0)\n"
    )
    executor = Executor()
    result, _snapshot, _stdout, _stderr, error = executor.execute(
        code, 16, language="python"
    )

    assert error is None
    assert result is not None
    assert result.metrics == {}


# ───────── Q# parameter binding (B4) ─────────


def test_qsharp_binds_params_by_name_with_double_formatted_with_a_dot():
    adapter = QsharpAdapter()

    result, snapshot, _stdout, _stderr, error = adapter.execute_source(
        QSHARP_ROTATE, 10, params={"theta": 2, "layers": 3}
    )

    assert error is None
    assert result is not None
    assert snapshot is not None
    rx_gates = [g for g in snapshot.gates if g.type == "RX"]
    assert len(rx_gates) == 3
    # theta=2 (a Python int) must render as the Q# Double literal "2.0" —
    # if it rendered as bare "2", qdk would reject it as an Int literal
    # bound to a Double parameter. The extracted gate's own params list is
    # a float either way, so this also indirectly proves the bind+compile
    # round-tripped successfully instead of silently no-oping.
    assert all(g.params == [2.0] for g in rx_gates)


def test_qsharp_missing_param_is_compile_error_before_any_run():
    adapter = QsharpAdapter()

    result, snapshot, _stdout, _stderr, error = adapter.execute_source(
        QSHARP_ROTATE, 10, params={"theta": 1.0}  # "layers" omitted
    )

    assert result is None
    assert snapshot is None
    assert error is not None
    assert error.code == "compile_error"
    assert "layers" in error.message


def test_qsharp_extra_param_is_compile_error():
    adapter = QsharpAdapter()

    result, snapshot, _stdout, _stderr, error = adapter.execute_source(
        QSHARP_ROTATE, 10, params={"theta": 1.0, "layers": 1, "extra": 5}
    )

    assert result is None
    assert snapshot is None
    assert error is not None
    assert error.code == "compile_error"
    assert "extra" in error.message


def test_qsharp_unsupported_param_type_is_compile_error():
    adapter = QsharpAdapter()
    source = (
        "operation Flagger(flag : Bool) : Result {\n"
        "    use q = Qubit();\n"
        "    let r = M(q);\n"
        "    Reset(q);\n"
        "    return r;\n"
        "}\n"
    )

    result, snapshot, _stdout, _stderr, error = adapter.execute_source(
        source, 10, params={"flag": 1}
    )

    assert result is None
    assert snapshot is None
    assert error is not None
    assert error.code == "compile_error"
    assert "Bool" in error.message


def test_qsharp_no_params_preserves_zero_param_only_entry_resolution():
    # Regression guard: when params is None (the field omitted entirely,
    # as older clients and casual Cmd+Enter runs on Q# do), an operation
    # that declares arguments must NOT become the entry point — exactly
    # the pre-Phase-B contract.
    adapter = QsharpAdapter()

    result, snapshot, _stdout, _stderr, error = adapter.execute_source(
        QSHARP_ROTATE, 10
    )

    assert result is None
    assert error is not None
    assert error.code == "no_circuit"


# ───────── seed_honored: false path ─────────


def test_seed_honored_is_false_when_adapter_cannot_seed(monkeypatch):
    """Monkeypatch an adapter that reports a seed was requested but not
    honored — mirrors an installed backend with no seeding API (e.g. an
    older cudaq build without `set_random_seed`)."""

    class UnseedableAdapter:
        def find_circuit(self, namespace: dict):
            return SimpleNamespace()

        def extract_snapshot(self, circuit_obj):
            return CircuitSnapshot(
                framework="qiskit",
                qubit_count=1,
                classical_bit_count=1,
                depth=1,
                gates=[Gate(type="H", targets=[0], layer=0)],
            )

        def simulate(self, circuit_obj, shots: int, seed: int | None = None):
            honored = False if seed is not None else None
            return SimulationResult(
                state_vector=[],
                probabilities={},
                measurements={},
                bloch_coords=[],
                execution_time_ms=0.1,
                shot_count=shots,
                seed_honored=honored,
            )

    fake_spec = AdapterSpec(
        framework="qiskit",
        module="kernel.adapters.qiskit_adapter",
        class_name="QiskitAdapter",
        detect_pattern=re.compile("qiskit"),
        dependencies=("qiskit", "qiskit_aer"),
    )
    adapter = UnseedableAdapter()
    executor = Executor()
    monkeypatch.setattr(executor, "_detect_adapter_spec", lambda code: fake_spec)
    monkeypatch.setattr(executor, "_load_adapter", lambda spec: (adapter, None))
    monkeypatch.setattr(executor, "_run_code", lambda code, **kwargs: ("", "", None))

    result, _snapshot, _stdout, _stderr, error = executor.execute(
        "import qiskit", 10, seed=42
    )

    assert error is None
    assert result is not None
    assert result.seed_honored is False


def test_seed_honored_omitted_when_no_seed_requested(monkeypatch):
    """The counterpart to the false-path test above: with no seed at all,
    seed_honored must not appear on the wire (SimulationResult.to_dict
    pops it when None) — verified at the to_dict layer here since the
    Executor-level object always carries the field, just as None."""

    class SimpleAdapter:
        def find_circuit(self, namespace: dict):
            return SimpleNamespace()

        def extract_snapshot(self, circuit_obj):
            return CircuitSnapshot(
                framework="qiskit",
                qubit_count=1,
                classical_bit_count=1,
                depth=1,
                gates=[Gate(type="H", targets=[0], layer=0)],
            )

        def simulate(self, circuit_obj, shots: int, seed: int | None = None):
            honored = False if seed is not None else None
            return SimulationResult(
                state_vector=[],
                probabilities={},
                measurements={},
                bloch_coords=[],
                execution_time_ms=0.1,
                shot_count=shots,
                seed_honored=honored,
            )

    fake_spec = AdapterSpec(
        framework="qiskit",
        module="kernel.adapters.qiskit_adapter",
        class_name="QiskitAdapter",
        detect_pattern=re.compile("qiskit"),
        dependencies=("qiskit", "qiskit_aer"),
    )
    adapter = SimpleAdapter()
    executor = Executor()
    monkeypatch.setattr(executor, "_detect_adapter_spec", lambda code: fake_spec)
    monkeypatch.setattr(executor, "_load_adapter", lambda spec: (adapter, None))
    monkeypatch.setattr(executor, "_run_code", lambda code, **kwargs: ("", "", None))

    result, _snapshot, _stdout, _stderr, error = executor.execute("import qiskit", 10)

    assert error is None
    assert result is not None
    assert result.seed_honored is None
    assert "seed_honored" not in result.to_dict()
    assert result.to_dict()["metrics"] == {}
