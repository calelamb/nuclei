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
    assert calls == [{"theta": 0.5}] and result.bound_at == {"theta": 0.5}


class _Unbound(ValueError):
    """Mirrors R-A's ``kernel.adapters.errors.UnboundParametersError`` (code/severity/parameters)."""

    code = "unbound_parameters"
    severity = "info"

    def __init__(self, parameters):
        self.parameters = list(parameters)
        super().__init__(f"{len(self.parameters)} free parameters ({', '.join(self.parameters)}); nothing to simulate.")


class _Unsupported(RuntimeError):
    """Mirrors R-A's ``UnsupportedInstructionError``."""

    code = "unsupported_instruction"
    severity = "error"

    def __init__(self, instruction):
        self.instruction = instruction
        super().__init__(f"The simulator cannot run the instruction '{instruction}'.")


def _stub_binding(monkeypatch, fn) -> list:
    import sys
    import types

    calls: list = []
    stub = types.ModuleType("kernel.adapters.binding")

    def bind_parameters(circuit, values=None, **kwargs):
        calls.append(values)
        return fn(circuit, values)

    stub.bind_parameters = bind_parameters
    monkeypatch.setitem(sys.modules, "kernel.adapters.binding", stub)
    return calls


def test_binding_is_consulted_even_without_parameter_values(monkeypatch) -> None:
    calls = _stub_binding(monkeypatch, lambda circuit, values: (circuit, {}))
    result, _s, _o, _e, error = Executor().execute(BELL, 16)
    assert error is None and result is not None and calls == [None]


def test_unbound_parameters_keep_their_typed_wire_shape(monkeypatch) -> None:
    def raise_unbound(circuit, values):
        raise _Unbound(["phi", "theta"])

    _stub_binding(monkeypatch, raise_unbound)
    snapshot_error = Executor().execute(BELL, 16)
    _result, snapshot, _out, _err, error = snapshot_error
    assert snapshot is not None, "the circuit still renders while the prompt is shown"
    assert error.code == "unbound_parameters" and error.framework == "qiskit"
    assert error.to_dict()["severity"] == "info" and error.to_dict()["parameters"] == ["phi", "theta"]


def test_unsupported_instruction_from_the_simulator_keeps_its_name(monkeypatch) -> None:
    from kernel.adapters import qiskit_adapter

    def refuse(self, circuit, shots, seed=None):
        raise _Unsupported("mystery_gate")

    monkeypatch.setattr(qiskit_adapter.QiskitAdapter, "simulate", refuse)
    _result, _snapshot, _out, _err, error = Executor().execute(BELL, 16)
    wire = error.to_dict()
    assert wire["code"] == "unsupported_instruction" and wire["instruction"] == "mystery_gate"
    assert wire["severity"] == "error" and "mystery_gate" in wire["message"]


def test_untyped_adapter_failures_are_still_classified_as_before(monkeypatch) -> None:
    def explode(circuit, values):
        raise RuntimeError("boom")

    _stub_binding(monkeypatch, explode)
    error = Executor().execute(BELL, 16, parameter_values={"theta": 1.0})[4]
    assert error.code == "adapter_error" and "severity" not in error.to_dict()


def test_execute_op_error_frame_is_the_ruled_unbound_parameters_shape(monkeypatch) -> None:
    """The exact frame `run_routes._fail` builds from the worker op's error: the ruled wire shape."""
    from types import SimpleNamespace

    from kernel.models import KernelError
    from kernel.models.errors import error_payload
    from kernel.run_ops_builtin import execute_op

    def raise_unbound(circuit, values):
        raise _Unbound(["theta"])

    _stub_binding(monkeypatch, raise_unbound)
    reply, error = execute_op(SimpleNamespace(request=None), {"code": BELL, "shots": 8})
    assert reply["snapshot"] is not None and reply["result"] is None
    frame = error_payload(KernelError.from_dict(error), "execute")
    assert frame["type"] == "error" and frame["phase"] == "execute"
    assert frame["code"] == "unbound_parameters" and frame["severity"] == "info" and frame["parameters"] == ["theta"]


@pytest.mark.parametrize(
    "msg,expected_level",
    [({}, 1), ({"optimization_level": None}, 1), ({"optimization_level": 9}, 1), ({"optimization_level": True}, 1),
     ({"optimization_level": "2"}, 1), ({"optimization_level": 0}, 0), ({"optimization_level": 3}, 3)],
)
def test_transpile_target_is_validated_at_the_boundary(msg: dict, expected_level: int) -> None:
    from kernel.run_routes import _transpile_target

    target = _transpile_target(msg)
    assert target == {"basis_gates": None, "coupling_map": None, "optimization_level": expected_level}


def test_transpile_target_keeps_well_formed_gates_and_coupling() -> None:
    from kernel.run_routes import _transpile_target

    good = _transpile_target({"basis_gates": ["cx", "rz"], "coupling_map": [(0, 1), [1, 2]]})
    assert good["basis_gates"] == ["cx", "rz"] and good["coupling_map"] == [[0, 1], [1, 2]]
    bad = _transpile_target({"basis_gates": ["cx", 3], "coupling_map": [[0, 1, 2]]})
    assert bad["basis_gates"] is None and bad["coupling_map"] is None


# ======================================================================================================
# The routed run path, through a real kernel process (PRD 15 R-B steps 5-10)
# ======================================================================================================

import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import statistics  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402

from kernel.tests._kernel_client import connect, drain, exchange  # noqa: E402
from kernel.tests._run_server_helpers import (  # noqa: E402
    BELL as BELL_CODE, SPIN, converse, error_codes, linux_only, run, running_descendants, start_kernel, types, warm_up,
)


@pytest.fixture(scope="module")
def kernel():
    instance = start_kernel()
    warm_up(instance)
    yield instance
    instance.stop()


@pytest.fixture(scope="module")
def short_wall_kernel():
    """A kernel whose every user-code wall limit is 3 s (the every-path timeout tests)."""
    instance = start_kernel(env={"NUCLEI_RUN_WALL_S": "3"})
    warm_up(instance)
    yield instance
    instance.stop()


def parse_msg(code: str, **extra) -> dict:
    return {"type": "parse", "code": code, "language": "python", **extra}


def exec_msg(code: str, **extra) -> dict:
    return {"type": "execute", "code": code, "language": "python", "shots": 64, **extra}


# -- R-6 / R-7: cancel, stale cancel ----------------------------------------------------------------------


@linux_only
def test_run_cancel_kills_within_1s(kernel) -> None:
    async def scenario():
        ws = await connect(kernel)
        await ws.send(json.dumps(exec_msg(SPIN, run_id="c1")))
        await asyncio.sleep(1.5)
        sent = time.monotonic()
        await ws.send(json.dumps({"type": "run_cancel", "run_id": "c1"}))
        frames, _ = await exchange(ws, {"type": "environment"}, {"result"}, 10)  # drains until the run's result frame
        elapsed = time.monotonic() - sent
        await asyncio.sleep(0.5)
        spinning = running_descendants(kernel._proc.pid)
        await ws.close()
        return frames, elapsed, spinning

    frames, elapsed, spinning = run(scenario())
    assert "run_cancelled" in types(frames)
    assert next(f for f in frames if f["type"] == "run_cancelled") == {"type": "run_cancelled", "run_id": "c1", "accepted": True}
    assert "cancelled" in error_codes(frames) and types(frames)[-1] in ("result", "environment")
    assert elapsed < 1.0, elapsed
    assert spinning == [], "a process is still burning CPU after the cancel"


def test_stale_run_cancel_is_ignored(kernel) -> None:
    async def scenario():
        ws = await connect(kernel)
        first, _ = await exchange(ws, exec_msg(BELL_CODE, run_id="s1"), {"result"}, 60)
        stale = []
        for run_id in ("s1", "never-started", None):
            frames, _ = await exchange(ws, {"type": "run_cancel", "run_id": run_id}, {"run_cancelled"}, 10)
            stale.append(frames[-1])
        slow = "import time\n" + BELL_CODE + "time.sleep(1.0)\n"
        await ws.send(json.dumps(exec_msg(slow, run_id="s2")))
        await asyncio.sleep(0.3)
        await ws.send(json.dumps({"type": "run_cancel", "run_id": "s1"}))  # a late Stop for the run that already finished
        rest, _ = await exchange(ws, {"type": "environment"}, {"result"}, 60)
        await ws.close()
        return first, stale, rest

    first, stale, rest = run(scenario())
    assert types(first)[-1] == "result" and not error_codes(first)
    assert [f["accepted"] for f in stale] == [False, False, False]
    assert next(f for f in rest if f["type"] == "run_cancelled")["accepted"] is False
    assert not error_codes(rest) and [f for f in rest if f["type"] == "result"][0]["data"] is not None


# -- R-8: queued parses never delay Run, and a program executes once ---------------------------------------


def test_queued_parses_do_not_delay_run(kernel) -> None:
    program = "import time\ntime.sleep(2.0)\n" + BELL_CODE

    async def scenario():
        ws = await connect(kernel)
        for _ in range(5):
            await ws.send(json.dumps(parse_msg(program)))
            await asyncio.sleep(0.3)
        frames, elapsed = await exchange(ws, exec_msg(program), {"result"}, 60)
        await ws.close()
        return frames, elapsed

    frames, elapsed = run(scenario())
    assert not error_codes(frames)
    simulate_s = [f for f in frames if f["type"] == "result"][0]["data"]["execution_time_ms"] / 1000
    assert elapsed <= 2.0 + 0.5 + simulate_s, f"Run took {elapsed:.2f}s behind five queued parses"


def test_single_exec_with_lab_open(kernel, tmp_path) -> None:
    log = tmp_path / "exec_log.txt"
    main = tmp_path / "main.py"
    code = f"with open({str(log)!r}, 'a') as handle:\n    handle.write('x')\n" + BELL_CODE
    main.write_text(code)
    paths = {"project_root": str(tmp_path), "file_path": str(main)}

    async def scenario():
        editor = await connect(kernel)
        lab = await connect(kernel)
        parsed, _ = await exchange(editor, parse_msg(code, **paths), {"snapshot"}, 60)
        inspected, _ = await exchange(lab, {"type": "trainability_inspect", "code": code, **paths}, {"trainability_inspected"}, 60)
        linted, _ = await exchange(lab, {"type": "trainability_lint", "code": code, **paths}, {"trainability_lint_result"}, 60)
        again, _ = await exchange(editor, parse_msg(code, **paths), {"snapshot"}, 60)
        await editor.close()
        await lab.close()
        return parsed, inspected, linted, again

    parsed, inspected, linted, again = run(scenario())
    assert types(parsed)[-1] == "snapshot" and not error_codes(parsed)
    assert inspected[-1]["type"] == "trainability_inspected" and linted[-1]["type"] == "trainability_lint_result"
    assert again[-1]["type"] == "snapshot"
    assert log.read_text() == "x", "the program executed more than once for one code version"


# -- R-9: paths --------------------------------------------------------------------------------------------


def test_path_traversal_refused(kernel, tmp_path) -> None:
    project = tmp_path / "proj"
    outside = tmp_path / "outside"
    project.mkdir()
    outside.mkdir()
    os.symlink(outside, project / "link")
    cases = {
        "file_dotdot": {"project_root": str(project), "file_path": "../x.py"},
        "run_dir_dotdot": {"project_root": str(project), "run_dir": "../escaped"},
        "symlink_escape": {"project_root": str(project), "file_path": "link/main.py"},
        "relative_root": {"project_root": "relative/dir"},
        "missing_root": {"project_root": str(tmp_path / "nope")},
    }

    async def scenario():
        out = {}
        for name, fields in cases.items():
            out[name] = await converse(kernel, [(exec_msg(BELL_CODE, **fields), {"result"}), (parse_msg(BELL_CODE, **{k: v for k, v in fields.items() if k != "run_dir"}), {"error", "snapshot"})])
        return out

    results = run(scenario())
    for name, (execute_frames, parse_frames) in results.items():
        assert error_codes(execute_frames) == ["invalid_path"], name
        assert types(execute_frames)[-1] == "result" and execute_frames[-1]["data"] is None, name
        if name != "run_dir_dotdot":  # parse takes no run_dir
            assert error_codes(parse_frames) == ["invalid_path"], name
        assert any(f.get("field") for f in execute_frames if f["type"] == "error"), name
    assert not (tmp_path / "escaped").exists() and not list(outside.iterdir())


def test_write_into_run_dir_and_project_files(kernel, tmp_path) -> None:
    (tmp_path / "hamiltonian.json").write_text('{"qubits": 2}')
    (tmp_path / "ansatz_lib_rbrp.py").write_text("from qiskit import QuantumCircuit\n\ndef build(n):\n    qc = QuantumCircuit(n, n)\n    qc.h(0)\n    qc.measure(range(n), range(n))\n    return qc\n")
    code = (
        "import json, os\nfrom ansatz_lib_rbrp import build\n"
        "n = json.load(open('hamiltonian.json'))['qubits']\n"
        "open(os.path.join(os.environ['NUCLEI_RUN_DIR'], 'energy.txt'), 'w').write('-1.1')\nqc = build(n)\n"
    )
    paths = {"project_root": str(tmp_path), "file_path": str(tmp_path / "main.py")}
    (frames,) = run(converse(kernel, [(exec_msg(code, run_id="w1", run_dir="experiments/t/runs/r1", **paths), {"result"})]))
    assert not error_codes(frames)
    result = [f for f in frames if f["type"] == "result"][0]
    assert (tmp_path / "experiments" / "t" / "runs" / "r1" / "energy.txt").read_text() == "-1.1"
    assert result["data"]["run_dir"] == str(tmp_path / "experiments" / "t" / "runs" / "r1")
    assert result["run_id"] == "w1" and {"queue_ms", "spawn_wait_ms", "exec_ms", "simulate_ms", "serialize_ms", "total_ms"} <= set(result["timing"])


def test_main_guard_runs(kernel) -> None:
    code = "from qiskit import QuantumCircuit\n\nif __name__ == '__main__':\n    qc = QuantumCircuit(2, 2)\n    qc.h(0)\n    qc.measure([0, 1], [0, 1])\n"
    parsed, executed = run(converse(kernel, [(parse_msg(code), {"snapshot"}), (exec_msg(code), {"result"})]))
    assert parsed[0]["data"]["qubit_count"] == 2 and not error_codes(parsed) and not error_codes(executed)


# -- R-11 --------------------------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def limited_memory_kernel():
    """A kernel with the documented 2 GiB simulation limit, so the refusal does not depend on host RAM."""
    instance = start_kernel(env={"NUCLEI_SIM_MEMORY_LIMIT_MB": "2048"})
    warm_up(instance)
    yield instance
    instance.stop()


def test_n30_too_many_qubits_fast(limited_memory_kernel) -> None:
    kernel = limited_memory_kernel
    code = "from qiskit import QuantumCircuit\nn = 30\nqc = QuantumCircuit(n, n)\nqc.h(0)\nqc.measure(range(n), range(n))\n"

    async def scenario():
        ws = await connect(kernel)
        frames, elapsed = await exchange(ws, exec_msg(code), {"result"}, 30)
        await ws.close()
        return frames, elapsed

    frames, elapsed = run(scenario())
    assert elapsed < 1.0, elapsed
    assert types(frames) == ["snapshot", "error", "result"] and frames[-1]["data"] is None
    error = frames[1]
    assert error["code"] == "too_many_qubits" and error["estimate"]["qubits"] == 30
    assert [a["id"] for a in error["actions"]] == ["rerun_mps", "open_lab"]
    assert max(len(json.dumps(f)) for f in frames) < 20_000


def test_mps_rerun_action_runs_the_circuit(kernel) -> None:
    code = "from qiskit import QuantumCircuit\nn = 30\nqc = QuantumCircuit(n, n)\nqc.h(0)\nfor q in range(1, n):\n    qc.cx(0, q)\nqc.measure(range(n), range(n))\n"
    (frames,) = run(converse(kernel, [(exec_msg(code, simulation_method="matrix_product_state"), {"result"})]))
    assert not error_codes(frames)
    data = [f for f in frames if f["type"] == "result"][0]["data"]
    assert sum(data["measurements"].values()) == 64 and data["state_vector"] == []


def test_n24_sampled_run_ok(kernel) -> None:
    code = "from qiskit import QuantumCircuit\nn = 24\nqc = QuantumCircuit(n, n)\nqc.h(0)\nfor q in range(1, n):\n    qc.cx(0, q)\nqc.measure(range(n), range(n))\n"
    (frames,) = run(converse(kernel, [(exec_msg(code, shots=256), {"result"})], timeout=120))
    assert not error_codes(frames)
    data = [f for f in frames if f["type"] == "result"][0]["data"]
    assert data["measurements_source"] == "sampled" and data["state_vector"] == []
    assert data["truncated"]["state_vector"] is True and sum(data["measurements"].values()) == 256
    assert max(len(json.dumps(f)) for f in frames) < 4_000_000


# -- R-12 / R-22 -------------------------------------------------------------------------------------------


def test_plt_show_with_display_returns_fast() -> None:
    kernel = start_kernel(display=":99")  # nothing listens on :99: a GUI backend would hang or die here
    try:
        warm_up(kernel)
        code = "import matplotlib.pyplot as plt\nfrom qiskit import QuantumCircuit\nplt.plot([0, 1], [1, 0])\nplt.title('convergence')\nplt.show()\nqc = QuantumCircuit(1, 1)\nqc.h(0)\nqc.measure(0, 0)\n"

        async def scenario():
            ws = await connect(kernel)
            frames, elapsed = await exchange(ws, exec_msg(code), {"result"}, 30)
            await ws.close()
            return frames, elapsed

        frames, elapsed = run(scenario())
        assert elapsed < 2.0 and not error_codes(frames)
        figures = [f for f in frames if f["type"] == "result"][0]["data"]["figures"]
        assert len(figures) == 1 and figures[0]["title"] == "convergence" and figures[0]["png_base64"].startswith("iVBOR")
    finally:
        kernel.stop()


def test_output_truncated_100k_lines(kernel) -> None:
    code = "from qiskit import QuantumCircuit\nfor i in range(100000):\n    print('line', i)\nqc = QuantumCircuit(1, 1)\nqc.measure(0, 0)\n"
    (frames,) = run(converse(kernel, [(exec_msg(code), {"result"})], timeout=120))
    outputs = [f for f in frames if f["type"] == "output"]
    assert sum(len(f["text"].encode()) for f in outputs if not f.get("output_truncated")) <= 256 * 1024
    notes = [f for f in outputs if f.get("output_truncated")]
    assert len(notes) == 1 and "output truncated" in notes[0]["text"] and notes[0]["dropped_bytes"] > 500_000
    assert max(len(json.dumps(f)) for f in frames) < 400_000 and not error_codes(frames)


# -- compatibility: no run_id means today's frames -----------------------------------------------------------


def test_no_run_id_frame_sequence_unchanged(kernel) -> None:
    # a loop keeps the program off the static fast path, which never runs (or prints from) the program
    printing = "for _ in range(1):\n    print('hi')\n" + BELL_CODE
    cases = [
        (parse_msg(BELL_CODE), {"snapshot"}, ["snapshot"]),
        (parse_msg(printing), {"snapshot"}, ["output", "snapshot"]),
        (exec_msg(BELL_CODE), {"result"}, ["snapshot", "result"]),
        (exec_msg(printing), {"result"}, ["output", "snapshot", "result"]),
        (exec_msg("raise ValueError('x')\n"), {"result"}, ["snapshot", "error", "result"]),
        (exec_msg("def (:\n"), {"result"}, ["snapshot", "error", "result"]),
        (exec_msg("x = 1\n"), {"result"}, ["snapshot", "error", "result"]),
        ({"type": "run_python", "code": "print('py')\n"}, {"python_result"}, ["output", "python_result"]),
        ({"type": "run_python", "code": "1/0\n"}, {"python_result"}, ["error", "python_result"]),
    ]
    results = run(converse(kernel, [(m, t) for m, t, _ in cases]))
    for (message, _terminal, expected), frames in zip(cases, results):
        assert types(frames) == expected, (message["type"], message["code"][:30], types(frames))
        assert not [f for f in frames if "run_id" in f or "timing" in f or "preview" in f], frames


def test_run_id_requests_echo_it_and_describe_the_preview(kernel) -> None:
    (parsed, executed) = run(converse(kernel, [(parse_msg(BELL_CODE, run_id="v1-a"), {"snapshot"}), (exec_msg(BELL_CODE, run_id="v1-b"), {"result"})]))
    snap = [f for f in parsed if f["type"] == "snapshot"][0]
    assert snap["run_id"] == "v1-a" and snap["preview"] in ("static", "exec", "cache") and snap["slow"] is False
    assert all(f.get("run_id") == "v1-b" for f in executed)


def test_bad_or_duplicate_run_ids_are_invalid_requests(kernel) -> None:
    async def scenario():
        ws = await connect(kernel)
        bad, _ = await exchange(ws, exec_msg(BELL_CODE, run_id="has space"), {"result"}, 10)
        slow = "import time\n" + BELL_CODE + "time.sleep(1.5)\n"
        await ws.send(json.dumps(exec_msg(slow, run_id="dup")))
        await asyncio.sleep(0.4)
        dup, _ = await exchange(ws, exec_msg(BELL_CODE, run_id="dup"), {"result"}, 30)
        rest = await drain(ws, 3.0)
        await ws.close()
        return bad, dup, rest

    bad, dup, rest = run(scenario())
    assert error_codes(bad) == ["invalid_request"]
    assert "invalid_request" in error_codes(dup)
    assert "result" in types(rest + dup)


# -- every exec path survives a runaway, an os._exit, a sibling import, a data read --------------------------------


TERMINALS = {
    "execute": ({"result"}, "result"), "run_python": ({"python_result"}, "python_result"),
    "transpile": ({"transpile_result"}, "transpile_result"), "debug_trace": ({"debug_trace_result"}, "debug_trace_result"),
    "parse": ({"snapshot", "error"}, None),
}


@pytest.mark.parametrize("op", sorted(TERMINALS))
@pytest.mark.parametrize("hazard, expected", [("spin", "timeout"), ("exit", "worker_died")])
def test_terminal_frames_on_timeout_or_death(short_wall_kernel, op: str, hazard: str, expected: str) -> None:
    body = SPIN if hazard == "spin" else "import os\n" + BELL_CODE + "os._exit(7)\n"
    message = {"type": op, "code": body, "language": "python", "shots": 16}
    terminal, closing = TERMINALS[op]
    started = time.monotonic()
    frames, probe = run(converse(short_wall_kernel, [(message, terminal), (exec_msg(BELL_CODE), {"result"})], timeout=30))
    assert expected in error_codes(frames), types(frames)
    assert time.monotonic() - started < 15
    if closing is not None:
        assert types(frames)[-1] == closing
    elif op == "parse":
        assert "snapshot" not in types(frames)  # the last diagram stays
    assert not error_codes(probe) and probe[-1]["type"] == "result", "the next request on the same socket failed"


def test_hardware_simulator_submit_runs_off_the_event_loop(short_wall_kernel) -> None:
    async def scenario():
        slow = await connect(short_wall_kernel)
        other = await connect(short_wall_kernel)
        await slow.send(json.dumps({"type": "hardware_submit", "provider": "simulator", "backend": "sim_qasm", "shots": 16, "code": SPIN, "language": "python"}))
        await asyncio.sleep(0.5)
        frames, elapsed = await exchange(other, parse_msg(BELL_CODE), {"snapshot"}, 10)
        submitted, _ = await exchange(slow, {"type": "environment"}, {"hardware_job_submitted", "error"}, 30)
        job = [f for f in submitted if f["type"] == "hardware_job_submitted"][0]["job"]
        results, _ = await exchange(slow, {"type": "hardware_results", "job_id": job["id"]}, {"hardware_result"}, 10)
        await slow.close()
        await other.close()
        return frames, elapsed, job, results

    frames, elapsed, job, results = run(scenario())
    assert types(frames)[-1] == "snapshot" and elapsed < 2.0, "another connection stalled behind a simulator submit"
    assert job["status"] == "failed"
    assert results[-1]["data"]["error"]["code"] == "timeout"


def test_hardware_python_submit_failure_is_a_friendly_error(short_wall_kernel) -> None:
    message = {"type": "hardware_submit", "provider": "ibm", "backend": "ibm_brisbane", "shots": 16, "code": SPIN, "language": "python"}
    (frames,) = run(converse(short_wall_kernel, [(message, {"error", "hardware_job_submitted"})], timeout=30))
    assert frames[-1]["type"] == "error" and "Hardware submit failed" in frames[-1]["message"]
    assert "ran longer than" in frames[-1]["message"]


# -- the tripwire: the server process never executes user code --------------------------------------------------


def test_server_main_forbids_inprocess_exec() -> None:
    from kernel import run_context

    run_context.forbid_inprocess_exec()
    try:
        with pytest.raises(run_context.InProcessExecForbidden):
            Executor().parse(BELL_CODE)
        with pytest.raises(run_context.InProcessExecForbidden):
            from kernel.trainability._usercode import run_namespace

            run_namespace("x = 1", None)
        with pytest.raises(run_context.InProcessExecForbidden):
            from kernel.qec.estimate import _qiskit_code_to_qasm3

            _qiskit_code_to_qasm3("x = 1")
    finally:
        run_context.allow_inprocess_exec()


def test_kernel_launched_as_a_module_works(tmp_path) -> None:
    instance = start_kernel(launch="module")
    try:
        (frames,) = run(converse(instance, [(parse_msg(BELL_CODE), {"snapshot"})]))
        assert not error_codes(frames) and frames[-1]["data"]["qubit_count"] == 2
        assert not [line for line in instance.stderr_lines if "Traceback" in line]
    finally:
        instance.stop()


# -- performance budgets (design note section 5) --------------------------------------------------------------------

TOLERANCE = 1.5 if sys.platform == "darwin" else 1.0  # the macOS runners are slower


@pytest.mark.slow
def test_latency_parse_p50(kernel) -> None:
    program = "total = 0\nfor i in range(20000):\n    total += i\n" + BELL_CODE  # a loop defeats the static fast path

    async def scenario():
        ws = await connect(kernel)
        overheads = []
        for index in range(20):
            started = time.monotonic()
            frames, _ = await exchange(ws, parse_msg(program + f"# edit {index}\n", run_id=f"lat-{index}"), {"snapshot"}, 30)
            snap = [f for f in frames if f["type"] == "snapshot"][0]
            assert snap["preview"] == "exec"
            overheads.append((time.monotonic() - started) * 1000 - snap["elapsed_ms"])
        await ws.close()
        return overheads

    overheads = run(scenario())
    assert statistics.median(overheads) <= 150 * TOLERANCE, overheads


@pytest.mark.slow
def test_latency_parse_static_p50(kernel) -> None:
    async def scenario():
        ws = await connect(kernel)
        times = []
        for index in range(20):
            started = time.monotonic()
            frames, _ = await exchange(ws, parse_msg(BELL_CODE + f"# {index}\n", run_id=f"st-{index}"), {"snapshot"}, 30)
            assert [f for f in frames if f["type"] == "snapshot"][0]["preview"] == "static"
            times.append((time.monotonic() - started) * 1000)
        await ws.close()
        return times

    assert statistics.median(run(scenario())) <= 150 * TOLERANCE


@pytest.mark.slow
def test_latency_run_overhead(kernel) -> None:
    async def scenario():
        ws = await connect(kernel)
        worst = 0.0
        for index in range(10):
            await asyncio.sleep(1.8)  # let the replacement spare finish importing
            frames, _ = await exchange(ws, exec_msg(BELL_CODE, run_id=f"ro-{index}"), {"result"}, 30)
            result = [f for f in frames if f["type"] == "result"][0]
            timing = result["timing"]
            assert timing["spawn_wait_ms"] == 0 or timing["spawn_wait_ms"] < 50, timing
            worst = max(worst, timing["total_ms"] - timing["exec_ms"] - timing["simulate_ms"])
        await ws.close()
        return worst

    assert run(scenario()) <= 300 * TOLERANCE


@pytest.mark.slow
def test_latency_lint_warm(kernel) -> None:
    from pathlib import Path

    source = Path(__file__).resolve().parents[2] / "tests" / "e2e" / "fixtures" / "lab-project" / "ansatz" / "hardware_efficient.py"
    if not source.is_file():
        pytest.skip("the lab-project fixture is not in this checkout")
    code = source.read_text()

    async def scenario():
        ws = await connect(kernel)
        await exchange(ws, {"type": "trainability_inspect", "code": code}, {"trainability_inspected", "error"}, 60)
        started = time.monotonic()
        frames, _ = await exchange(ws, {"type": "trainability_lint", "code": code}, {"trainability_lint_result", "error"}, 30)
        elapsed = time.monotonic() - started
        await ws.close()
        return frames, elapsed

    frames, elapsed = run(scenario())
    assert frames[-1]["type"] == "trainability_lint_result", frames[-1]
    assert elapsed <= 0.35 * TOLERANCE, elapsed
