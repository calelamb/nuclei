from types import SimpleNamespace

from kernel.executor import AdapterSpec, Executor
from kernel.models import CircuitSnapshot, Gate, KernelError, SimulationResult


class StubAdapter:
    def __init__(self, circuit=None, snapshot=None, result=None, simulate_error=None):
        self._circuit = circuit
        self._snapshot = snapshot
        self._result = result
        self._simulate_error = simulate_error

    def find_circuit(self, namespace: dict):
        return self._circuit

    def extract_snapshot(self, circuit_obj):
        return self._snapshot

    def simulate(self, circuit_obj, shots: int):
        if self._simulate_error:
            raise self._simulate_error
        return self._result


FAKE_SPEC = AdapterSpec(
    framework="qiskit",
    module="kernel.adapters.qiskit_adapter",
    class_name="QiskitAdapter",
    detect_pattern=__import__("re").compile("qiskit"),
    dependencies=("qiskit", "qiskit_aer"),
)


def test_executor_initializes_without_importing_adapters(monkeypatch):
    imported_modules: list[str] = []

    def fake_import(name: str, package=None):
        imported_modules.append(name)
        raise AssertionError("adapter modules should not be imported during Executor() init")

    monkeypatch.setattr("kernel.executor.importlib.import_module", fake_import)

    Executor()

    assert imported_modules == []


def test_parse_returns_missing_dependency_when_adapter_module_unavailable(monkeypatch):
    executor = Executor()

    def fake_import(name: str, package=None):
        raise ImportError("No module named 'cirq'", name="cirq")

    monkeypatch.setattr("kernel.executor.importlib.import_module", fake_import)

    snapshot, stdout, stderr, error = executor.parse("import cirq\ncircuit = None\n")

    assert snapshot is None
    assert stdout == ""
    assert stderr == ""
    assert error is not None
    assert error.code == "missing_dependency"
    assert error.framework == "cirq"
    assert error.dependency == "cirq"


def test_run_python_executes_plain_python_code():
    executor = Executor()

    stdout, stderr, error = executor.run_python("print('hello from nuclei')")

    assert error is None
    assert stdout.strip() == "hello from nuclei"
    assert stderr == ""


def test_run_python_returns_compile_error_for_invalid_syntax():
    executor = Executor()

    stdout, stderr, error = executor.run_python("def broken(:\n    pass")

    assert stdout == ""
    assert stderr == ""
    assert error is not None
    assert error.code == "compile_error"


def test_run_python_separates_stderr_from_stdout():
    executor = Executor()

    stdout, stderr, error = executor.run_python(
        "import sys\nprint('stdout here')\nprint('stderr here', file=sys.stderr)"
    )

    assert error is None
    assert "stdout here" in stdout
    assert "stderr here" in stderr
    # Ensure the two streams didn't cross-contaminate each other.
    assert "stderr here" not in stdout
    assert "stdout here" not in stderr


def test_parse_returns_empty_snapshot_for_valid_code_without_circuit(monkeypatch):
    executor = Executor()
    adapter = StubAdapter(circuit=None)

    monkeypatch.setattr(executor, "_detect_adapter_spec", lambda code: FAKE_SPEC)
    monkeypatch.setattr(executor, "_load_adapter", lambda spec: (adapter, None))
    monkeypatch.setattr(executor, "_run_code", lambda code: ("printed output\n", "", None))

    snapshot, stdout, stderr, error = executor.parse("from qiskit import QuantumCircuit")

    assert snapshot is None
    assert stdout == "printed output\n"
    assert stderr == ""
    assert error is None


def test_parse_normalizes_module_not_found_to_missing_dependency(monkeypatch):
    executor = Executor()
    adapter = StubAdapter()
    runtime_error = KernelError(
        code="execution_error",
        message="ModuleNotFoundError: No module named 'qiskit'",
        traceback="Traceback...\nModuleNotFoundError: No module named 'qiskit'\n",
    )

    monkeypatch.setattr(executor, "_detect_adapter_spec", lambda code: FAKE_SPEC)
    monkeypatch.setattr(executor, "_load_adapter", lambda spec: (adapter, None))
    monkeypatch.setattr(executor, "_run_code", lambda code: ("", "", runtime_error))

    snapshot, stdout, stderr, error = executor.parse("import qiskit")

    assert snapshot is None
    assert stdout == ""
    assert stderr == ""
    assert error is not None
    assert error.code == "missing_dependency"
    assert error.framework == "qiskit"
    assert error.dependency == "qiskit"


def test_execute_returns_no_circuit_error_for_non_quantum_code():
    executor = Executor()

    result, snapshot, stdout, stderr, error = executor.execute("print('plain python')", 256)

    assert result is None
    assert snapshot is None
    assert stdout == ""
    assert stderr == ""
    assert error is not None
    assert error.code == "unsupported_framework"


def test_execute_returns_snapshot_and_typed_simulation_error(monkeypatch):
    executor = Executor()
    snapshot = CircuitSnapshot(
        framework="qiskit",
        qubit_count=1,
        classical_bit_count=1,
        depth=1,
        gates=[Gate(type="H", targets=[0], layer=0)],
    )
    adapter = StubAdapter(
        circuit=SimpleNamespace(),
        snapshot=snapshot,
        result=None,
        simulate_error=RuntimeError("simulator exploded"),
    )

    monkeypatch.setattr(executor, "_detect_adapter_spec", lambda code: FAKE_SPEC)
    monkeypatch.setattr(executor, "_load_adapter", lambda spec: (adapter, None))
    monkeypatch.setattr(executor, "_run_code", lambda code: ("", "", None))

    result, returned_snapshot, stdout, stderr, error = executor.execute("import qiskit", 512)

    assert result is None
    assert returned_snapshot == snapshot
    assert stdout == ""
    assert stderr == ""
    assert error is not None
    assert error.code == "simulation_error"


def test_execute_returns_result_when_stub_adapter_succeeds(monkeypatch):
    executor = Executor()
    snapshot = CircuitSnapshot(
        framework="qiskit",
        qubit_count=1,
        classical_bit_count=1,
        depth=1,
        gates=[Gate(type="H", targets=[0], layer=0)],
    )
    result = SimulationResult(
        state_vector=[{"re": 1.0, "im": 0.0}],
        probabilities={"0": 1.0},
        measurements={"0": 256},
        bloch_coords=[{"x": 0.0, "y": 0.0, "z": 1.0}],
        execution_time_ms=1.2,
        shot_count=256,
    )
    adapter = StubAdapter(circuit=SimpleNamespace(), snapshot=snapshot, result=result)

    monkeypatch.setattr(executor, "_detect_adapter_spec", lambda code: FAKE_SPEC)
    monkeypatch.setattr(executor, "_load_adapter", lambda spec: (adapter, None))
    monkeypatch.setattr(executor, "_run_code", lambda code: ("", "", None))

    actual_result, returned_snapshot, stdout, stderr, error = executor.execute("import qiskit", 256)

    assert error is None
    assert stdout == ""
    assert stderr == ""
    assert returned_snapshot == snapshot
    assert actual_result == result
