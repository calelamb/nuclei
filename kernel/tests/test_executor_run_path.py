"""PRD 15 R-B: the user-code run path (in-process Executor behaviour; pooled routes are below)."""

from __future__ import annotations

import pytest

from kernel.executor import Executor

BELL = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n"


# -- R-10: a real __main__ ---------------------------------------------------------


def test_main_guard_program_runs() -> None:
    code = "from qiskit import QuantumCircuit\n\nif __name__ == '__main__':\n    qc = QuantumCircuit(2)\n    qc.h(0)\n"
    snapshot, _out, _err, error = Executor().parse(code)
    assert error is None and snapshot is not None and snapshot.qubit_count == 2


def test_file_is_defined_for_programs() -> None:
    code = "import os\nfrom qiskit import QuantumCircuit\nassert isinstance(__file__, str)\nqc = QuantumCircuit(1)\n"
    snapshot, _out, _err, error = Executor().parse(code)
    assert error is None and snapshot is not None


# -- R-7: SystemExit never escapes ---------------------------------------------------


@pytest.mark.parametrize("call", ["sys.exit(0)", "sys.exit(3)", "sys.exit('bye')", "exit()", "quit(2)", "raise SystemExit"])
def test_system_exit_becomes_user_exit(call: str) -> None:
    code = f"import sys\nfrom qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\n{call}\n"
    snapshot, _out, _err, error = Executor().parse(code)
    assert snapshot is None
    assert error is not None and error.code == "user_exit"
    assert "the run was ended" in error.message
    assert "exit_code" in error.to_dict()


def test_exit_code_is_reported() -> None:
    _s, _o, _e, error = Executor().parse("import sys\nfrom qiskit import QuantumCircuit\nsys.exit(3)\n")
    assert error is not None and error.to_dict()["exit_code"] == 3


# -- R-3: circuits found by type when the file itself imports no framework ------------


def test_circuit_built_in_a_helper_is_found_by_type(tmp_path, monkeypatch) -> None:
    helper = tmp_path / "ansatz_lib_rb_test.py"
    helper.write_text("from qiskit import QuantumCircuit\n\ndef build():\n    qc = QuantumCircuit(3)\n    qc.h(0)\n    return qc\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    snapshot, _o, _e, error = Executor().parse("from ansatz_lib_rb_test import build\nqc = build()\n")
    assert error is None and snapshot is not None and snapshot.framework == "qiskit" and snapshot.qubit_count == 3


def test_plain_python_is_not_run_when_it_imports_nothing_foreign() -> None:
    snapshot, out, _err, error = Executor().parse("print('hello')\n")
    assert snapshot is None and out == "" and error is not None and error.code == "unsupported_framework"


def test_foreign_import_without_a_circuit_is_unsupported_framework() -> None:
    snapshot, _o, _e, error = Executor().parse("import json\nimport hashlib\nvalue = 1\n")
    assert snapshot is None and error is not None and error.code == "unsupported_framework"


@pytest.mark.parametrize("imports", ["from qiskit.circuit import QuantumCircuit", "from qiskit_aer import AerSimulator\nfrom qiskit.circuit import QuantumCircuit"])
def test_submodule_imports_are_detected(imports: str) -> None:
    code = f"{imports}\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.measure([0, 1], [0, 1])\n"
    result, snapshot, _o, _e, error = Executor().execute(code, 64)
    assert error is None and snapshot.framework == "qiskit" and result.shot_count == 64


# -- transpile no longer hits the latent NameError --------------------------------------


def test_transpile_runs_for_qiskit_code() -> None:
    payload, _o, _e, error = Executor().transpile(BELL, basis_gates=["cx", "rz", "sx", "x"])
    assert error is None and payload["num_qubits"] == 2


def test_transpile_missing_qiskit_dependency_reports_it(monkeypatch) -> None:
    import builtins

    real_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name == "qiskit" and args and args[2] and "transpile" in args[2]:
            raise ImportError("no qiskit", name="qiskit")
        return real_import(name, *args, **kwargs)

    executor = Executor()
    monkeypatch.setattr(builtins, "__import__", blocked)
    payload, _o, _e, error = executor.transpile(BELL)
    monkeypatch.undo()
    assert payload is None and error is not None and error.code == "missing_dependency" and error.framework == "qiskit"


# -- R-11: the memory policy inside execute ------------------------------------------------


def test_n30_is_refused_before_allocating(monkeypatch) -> None:
    from kernel import run_memory

    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 64 * (1 << 30))
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(30, 30)\nqc.h(0)\nqc.measure(range(30), range(30))\n"
    result, snapshot, _o, _e, error = Executor().execute(code, 16)
    assert result is None and snapshot is not None and snapshot.qubit_count == 30
    assert error is not None and error.code == "too_many_qubits"
    assert error.to_dict()["actions"][0]["id"] == "rerun_mps"


def test_n18_runs_lean_and_withholds_the_state_vector() -> None:
    code = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(18, 18)\nqc.h(0)\nqc.measure(range(18), range(18))\n"
    result, _s, _o, _e, error = Executor().execute(code, 64, seed=5)
    assert error is None
    data = result.to_dict()
    assert data["state_vector"] == [] and data["truncated"]["state_vector"] is True


def test_mps_rerun_runs_a_large_circuit() -> None:
    code = "from qiskit import QuantumCircuit\nn = 40\nqc = QuantumCircuit(n, n)\nqc.h(0)\nfor q in range(1, n):\n    qc.cx(0, q)\nqc.measure(range(n), range(n))\n"
    result, _s, _o, _e, error = Executor().execute(code, 32, seed=1, simulation_method="matrix_product_state")
    assert error is None and sum(result.measurements.values()) == 32 and set(result.measurements) <= {"0" * 40, "1" * 40}


# -- R-4: parameter binding delegates to R-A's module ------------------------------------------


def test_parameter_values_use_the_binding_module(monkeypatch) -> None:
    import sys
    import types

    calls: list = []
    stub = types.ModuleType("kernel.adapters.binding")

    def bind_parameters(circuit, values):
        calls.append(dict(values))
        return circuit, {"theta": 0.5}

    stub.bind_parameters = bind_parameters
    monkeypatch.setitem(sys.modules, "kernel.adapters.binding", stub)
    executor = Executor()
    result, _s, _o, _e, error = executor.execute(BELL, 16, parameter_values={"theta": 0.5})
    assert error is None and result is not None
    assert calls == [{"theta": 0.5}] and executor.result_extras["bound_at"] == {"theta": 0.5}
