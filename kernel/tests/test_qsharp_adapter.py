"""QsharpAdapter tests — exercises the real qdk (Microsoft QDK) package.

Q# is a source-mode framework: the adapter compiles and simulates Q# source
through the qdk interpreter instead of the exec()-based Python pipeline.
These tests run against the real qdk package (installed locally and in CI),
covering parse, execute, entry resolution, error mapping, QIR compilation,
and Executor routing.
"""

from __future__ import annotations

import concurrent.futures
import sys
import threading

import pytest

from kernel.adapters.qsharp_adapter import QsharpAdapter
from kernel.executor import ADAPTER_SPECS, Executor

# The future Q# starter template: Bell state with a live state dump.
BELL = """\
import Std.Diagnostics.DumpMachine;

// Create a Bell State
operation Main() : Result[] {
    use qs = Qubit[2];
    H(qs[0]);
    CNOT(qs[0], qs[1]);
    DumpMachine();        // shows the live quantum state in Nuclei's panels
    let results = [M(qs[0]), M(qs[1])];
    ResetAll(qs);
    return results;
}
"""

# Same Bell circuit without DumpMachine — exercises the no-statevector
# fallback where bloch coords come from measurement marginals.
BELL_NO_DUMP = """\
operation Main() : Result[] {
    use qs = Qubit[2];
    H(qs[0]);
    CNOT(qs[0], qs[1]);
    let results = [M(qs[0]), M(qs[1])];
    ResetAll(qs);
    return results;
}
"""

QSHARP_SPEC = next(spec for spec in ADAPTER_SPECS if spec.framework == "qsharp")


# ───────── parse_source ─────────


def test_parse_source_bell_builds_snapshot():
    adapter = QsharpAdapter()
    snapshot, stdout, stderr, error = adapter.parse_source(BELL)

    assert error is None
    assert snapshot is not None
    assert snapshot.framework == "qsharp"
    assert snapshot.qubit_count == 2
    assert snapshot.classical_bit_count == 2
    assert snapshot.depth >= 3

    gate_types = [g.type for g in snapshot.gates]
    h_gates = [g for g in snapshot.gates if g.type == "H"]
    cnot_gates = [g for g in snapshot.gates if g.type == "CNOT"]
    assert len(h_gates) == 1
    assert h_gates[0].targets == [0]
    assert len(cnot_gates) == 1
    assert cnot_gates[0].controls == [0]
    assert cnot_gates[0].targets == [1]
    assert gate_types.count("Measure") == 2
    assert gate_types.count("Reset") == 2


def test_parse_source_syntax_error_yields_compile_error():
    adapter = QsharpAdapter()
    snapshot, stdout, stderr, error = adapter.parse_source("operation Broken( { nope }")

    assert snapshot is None
    assert error is not None
    assert error.code == "compile_error"
    assert error.message
    assert error.traceback
    assert "syntax error" in error.traceback or "expected" in error.traceback
    assert error.framework == "qsharp"


def test_parse_source_no_runnable_operation_is_quiet():
    # Mirrors the Python-framework parse contract: no circuit means a None
    # snapshot with NO error, so live-typing doesn't spam the error panel.
    adapter = QsharpAdapter()
    source = "operation NeedsArgs(n : Int) : Unit {}"
    snapshot, stdout, stderr, error = adapter.parse_source(source)

    assert snapshot is None
    assert error is None


# ───────── entry resolution ─────────


def test_entry_resolution_prefers_main():
    adapter = QsharpAdapter()
    source = """\
operation Foo() : Result {
    use q = Qubit();
    H(q);
    let r = M(q);
    Reset(q);
    return r;
}
operation Main() : Result[] {
    use qs = Qubit[2];
    H(qs[0]);
    CNOT(qs[0], qs[1]);
    let results = [M(qs[0]), M(qs[1])];
    ResetAll(qs);
    return results;
}
"""
    snapshot, _, _, error = adapter.parse_source(source)

    assert error is None
    assert snapshot is not None
    # Foo uses 1 qubit, Main uses 2 — Main must win.
    assert snapshot.qubit_count == 2


def test_entry_resolution_last_zero_param_op_wins_without_main():
    adapter = QsharpAdapter()
    source = """\
operation First() : Result {
    use q = Qubit();
    H(q);
    let r = M(q);
    Reset(q);
    return r;
}
operation Second() : Result[] {
    use qs = Qubit[3];
    H(qs[0]);
    let results = [M(qs[0]), M(qs[1]), M(qs[2])];
    ResetAll(qs);
    return results;
}
"""
    snapshot, _, _, error = adapter.parse_source(source)

    assert error is None
    assert snapshot is not None
    # First uses 1 qubit, Second uses 3 — the LAST defined op must win.
    assert snapshot.qubit_count == 3


def test_execute_source_without_runnable_operation_returns_no_circuit():
    adapter = QsharpAdapter()
    source = "operation NeedsArgs(n : Int) : Unit {}"
    result, snapshot, stdout, stderr, error = adapter.execute_source(source, 10)

    assert result is None
    assert snapshot is None
    assert error is not None
    assert error.code == "no_circuit"
    assert error.framework == "qsharp"


# ───────── execute_source ─────────


def test_execute_source_bell_with_dump_returns_exact_state():
    adapter = QsharpAdapter()
    result, snapshot, stdout, stderr, error = adapter.execute_source(BELL, 200)

    assert error is None
    assert snapshot is not None
    assert result is not None
    assert result.shot_count == 200
    assert result.execution_time_ms > 0

    # Exact statevector from DumpMachine: (|00> + |11>)/sqrt(2).
    assert len(result.state_vector) == 4
    amp00 = result.state_vector[0]
    amp11 = result.state_vector[3]
    assert abs((amp00["re"] ** 2 + amp00["im"] ** 2) ** 0.5 - 0.7071) < 0.001
    assert abs((amp11["re"] ** 2 + amp11["im"] ** 2) ** 0.5 - 0.7071) < 0.001

    assert set(result.probabilities.keys()) == {"00", "11"}
    assert abs(result.probabilities["00"] - 0.5) < 0.02
    assert abs(result.probabilities["11"] - 0.5) < 0.02

    assert set(result.measurements.keys()) <= {"00", "11"}
    assert sum(result.measurements.values()) == 200

    assert len(result.bloch_coords) == 2
    for coords in result.bloch_coords:
        assert abs(coords["z"]) < 0.05


@pytest.mark.parametrize("bad_shots", [0, -5, 2.5, "100", None])
def test_execute_source_rejects_invalid_shots(bad_shots):
    adapter = QsharpAdapter()
    result, snapshot, stdout, stderr, error = adapter.execute_source(BELL, bad_shots)

    assert result is None
    assert snapshot is None
    assert error is not None
    assert error.code == "execution_error"
    assert "shots must be a positive integer" in error.message
    assert repr(bad_shots) in error.message
    assert error.framework == "qsharp"


def test_execute_source_without_dump_falls_back_to_sampled_bloch():
    adapter = QsharpAdapter()
    result, snapshot, stdout, stderr, error = adapter.execute_source(BELL_NO_DUMP, 400)

    assert error is None
    assert result is not None
    assert result.state_vector == []

    assert set(result.measurements.keys()) <= {"00", "11"}
    assert sum(result.measurements.values()) == 400

    assert len(result.bloch_coords) == 2
    for coords in result.bloch_coords:
        assert coords["x"] == 0.0
        assert coords["y"] == 0.0
        assert abs(coords["z"]) < 0.15


# ───────── concurrency ─────────


def test_concurrent_parse_and_execute_do_not_corrupt_sessions(monkeypatch):
    # Regression: the qdk interpreter context is pyo3-unsendable — pinned to
    # the thread that created it. server.py runs adapter calls via
    # asyncio.to_thread (a multi-thread pool), so without the adapter's
    # dedicated single interpreter thread, consecutive calls land on
    # different threads and every cross-thread qsharp.init() drops a
    # foreign-thread context: an unraisable RuntimeError plus a leaked
    # interpreter context per call. The storm below must produce valid
    # snapshots/results AND zero unraisable exceptions, with every
    # interpreter touch happening on the dedicated qsharp-interp thread.
    interp_thread_names: list[str] = []
    original_compile = QsharpAdapter._compile_and_snapshot

    def recording_compile(self, code):
        # Tiny instrumentation hook: _compile_and_snapshot is the qdk work
        # (init/eval/circuit) shared by both parse and execute pipelines.
        interp_thread_names.append(threading.current_thread().name)
        return original_compile(self, code)

    monkeypatch.setattr(QsharpAdapter, "_compile_and_snapshot", recording_compile)

    unraisable: list[object] = []
    monkeypatch.setattr(sys, "unraisablehook", unraisable.append)

    def parse_job():
        snapshot, _stdout, _stderr, error = QsharpAdapter().parse_source(BELL)
        return "parse", error, snapshot, None

    def execute_job():
        result, snapshot, _stdout, _stderr, error = QsharpAdapter().execute_source(
            BELL, 50
        )
        return "execute", error, snapshot, result

    jobs = [parse_job, execute_job] * 4  # 8 mixed calls
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(job) for job in jobs]
        outcomes = [future.result() for future in futures]

    for kind, error, snapshot, result in outcomes:
        assert error is None
        assert snapshot is not None
        assert snapshot.qubit_count == 2
        assert "CNOT" in [g.type for g in snapshot.gates]
        if kind == "execute":
            assert result is not None
            assert set(result.measurements.keys()) <= {"00", "11"}
            assert sum(result.measurements.values()) == 50

    # The actual regression: cross-thread context drops surface as
    # unraisable RuntimeErrors ("Interpreter is unsendable, but is being
    # dropped on another thread"). The dedicated thread means exactly zero.
    assert unraisable == []

    # Every qdk critical section ran on the single dedicated thread.
    assert len(interp_thread_names) == len(jobs)
    assert all(name.startswith("qsharp-interp") for name in interp_thread_names)


# ───────── gate mapping ─────────


def test_mresetz_maps_to_measure_then_reset():
    adapter = QsharpAdapter()
    source = """\
operation Main() : Result {
    use q = Qubit();
    H(q);
    let r = MResetZ(q);
    return r;
}
"""
    snapshot, _, _, error = adapter.parse_source(source)

    assert error is None
    assert snapshot is not None
    gate_types = [g.type for g in snapshot.gates]
    measure_idx = gate_types.index("Measure")
    reset_idx = gate_types.index("Reset")
    assert measure_idx < reset_idx


# ───────── compile_qir ─────────


def test_compile_qir_base_profile_returns_qir():
    adapter = QsharpAdapter()
    qir = adapter.compile_qir(BELL_NO_DUMP, "base")

    assert qir is not None
    # azure-quantum detects QIR payloads via the _repr_qir_ protocol — the
    # returned object (not a string) must expose it.
    assert hasattr(qir, "_repr_qir_")
    text = str(qir)
    assert "ENTRYPOINT" in text or "%Qubit" in text


def test_compile_qir_adaptive_ri_profile_returns_qir():
    adapter = QsharpAdapter()
    qir = adapter.compile_qir(BELL_NO_DUMP, "adaptive_ri")

    assert qir is not None
    assert hasattr(qir, "_repr_qir_")
    text = str(qir)
    assert "ENTRYPOINT" in text or "%Qubit" in text


def test_compile_qir_unknown_profile_raises_value_error():
    adapter = QsharpAdapter()
    with pytest.raises(ValueError, match="target profile"):
        adapter.compile_qir(BELL_NO_DUMP, "totally_bogus")


# ───────── Executor routing ─────────


def test_executor_parse_with_qsharp_language_routes_to_adapter():
    executor = Executor()
    snapshot, stdout, stderr, error = executor.parse(BELL, language="qsharp")

    assert error is None
    assert snapshot is not None
    assert snapshot.framework == "qsharp"


def test_executor_execute_with_qsharp_language_returns_result_and_snapshot():
    executor = Executor()
    result, snapshot, stdout, stderr, error = executor.execute(
        BELL, 100, language="qsharp"
    )

    assert error is None
    assert result is not None
    assert result.shot_count == 100
    assert snapshot is not None
    assert snapshot.framework == "qsharp"


def test_executor_parse_detects_qsharp_without_language_hint():
    executor = Executor()
    snapshot, stdout, stderr, error = executor.parse(BELL)

    assert error is None
    assert snapshot is not None
    assert snapshot.framework == "qsharp"


def test_executor_language_python_skips_qsharp_adapter():
    # Q#-looking code forced through the Python pipeline must NOT route to
    # the qsharp adapter — it matches no Python spec, so it's unsupported.
    executor = Executor()
    snapshot, stdout, stderr, error = executor.parse(BELL, language="python")

    assert snapshot is None
    assert error is not None
    assert error.code == "unsupported_framework"


# ───────── detect pattern ─────────


def test_qsharp_detect_pattern_ignores_python_starter_templates():
    qiskit_code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\n"
    cirq_code = "import cirq\nq = cirq.LineQubit.range(2)\ncircuit = cirq.Circuit()\n"
    cudaq_code = "import cudaq\n\n@cudaq.kernel\ndef bell():\n    pass\n"

    for code in (qiskit_code, cirq_code, cudaq_code):
        assert not QSHARP_SPEC.detect_pattern.search(code)


def test_plain_python_still_unsupported_framework():
    executor = Executor()
    snapshot, stdout, stderr, error = executor.parse("x = 1 + 1\nprint(x)\n")

    assert snapshot is None
    assert error is not None
    assert error.code == "unsupported_framework"
