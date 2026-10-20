"""PRD 15 Wave 0b integration: R-A's adapters wired into R-B's execution model.

Everything here goes through the REAL authenticated server and run-worker pool (a spawned
kernel process), except the two in-process checks that need a spy inside the worker's modules.
"""

from __future__ import annotations

import sys

import pytest

from kernel.tests._run_server_helpers import converse, error_codes, run, start_kernel, warm_up

linux_only = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="the run-worker pool tests drive /proc")

ANSATZ = (
    "from qiskit import QuantumCircuit\nfrom qiskit.circuit import Parameter\n"
    "theta = Parameter('theta')\nqc = QuantumCircuit(1, 1)\nqc.ry(theta, 0)\nqc.measure(0, 0)\n"
)
MYSTERY = (
    "from qiskit import QuantumCircuit\nfrom qiskit.circuit import Instruction\n"
    "qc = QuantumCircuit(1)\nqc.append(Instruction('mystery_gate', 1, 0, []), [0])\n"
)
# Only the diagram reader (`extract_snapshot`) trips on this subclass; the simulator never asks it.
SNAPSHOT_BROKEN = (
    "import sys\nfrom qiskit import QuantumCircuit\n"
    "class Fussy(QuantumCircuit):\n"
    "    @property\n    def num_clbits(self):\n"
    "        if sys._getframe(1).f_code.co_name == 'extract_snapshot':\n            raise RuntimeError('snapshot exploded')\n"
    "        return super().num_clbits\n"
    "qc = Fussy(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n"
)
GHZ18 = "from qiskit import QuantumCircuit\nqc = QuantumCircuit(18, 18)\nqc.h(0)\nqc.measure(range(18), range(18))\n"


def execute(code: str, **extra) -> dict:
    return {"type": "execute", "code": code, "language": "python", "shots": 64, **extra}


@pytest.fixture(scope="module")
def kernel():
    instance = start_kernel()
    warm_up(instance)
    yield instance
    instance.stop()


def send(kernel, message: dict) -> list[dict]:
    (frames,) = run(converse(kernel, [(message, {"result"})]))
    return frames


def error_frames(frames: list[dict]) -> list[dict]:
    return [f for f in frames if f.get("type") == "error"]


@linux_only
@pytest.mark.parametrize("extra", [{"run_id": "ub1"}, {}], ids=["with_run_id", "without_run_id"])
def test_unbound_parameters_reach_the_wire_as_an_info_error(kernel, extra) -> None:
    frames = send(kernel, execute(ANSATZ, **extra))
    (error,) = error_frames(frames)
    assert error["code"] == "unbound_parameters"
    assert error["severity"] == "info"
    assert error["parameters"] == ["theta"]


@linux_only
@pytest.mark.parametrize("extra", [{"run_id": "us1"}, {}], ids=["with_run_id", "without_run_id"])
def test_unsupported_instruction_names_the_gate_on_the_wire(kernel, extra) -> None:
    frames = send(kernel, execute(MYSTERY, **extra))
    (error,) = error_frames(frames)
    assert error["code"] == "unsupported_instruction"
    assert error["instruction"] == "mystery_gate"
    assert "mystery_gate" in error["message"]


@linux_only
@pytest.mark.parametrize("extra", [{"run_id": "pv1"}, {}], ids=["with_run_id", "without_run_id"])
def test_parameter_values_bind_through_adapters_binding_and_report_bound_at(kernel, extra) -> None:
    frames = send(kernel, execute(ANSATZ, parameter_values={"theta": 3.141592653589793}, **extra))
    assert not error_codes(frames)
    result = [f for f in frames if f["type"] == "result"][0]
    assert result["data"]["bound_at"] == {"theta": 3.141592653589793}
    assert result["data"]["measurements"].get("1", 0) == 64  # RY(pi)|0> = |1>


@linux_only
def test_a_snapshot_failure_still_lets_the_circuit_run(kernel) -> None:
    frames = send(kernel, execute(SNAPSHOT_BROKEN, run_id="sf1"))
    assert not error_codes(frames)
    result = [f for f in frames if f["type"] == "result"][0]
    assert result["data"]["probabilities"], "the simulation must still produce a result"
    (snapshot,) = [f for f in frames if f["type"] == "snapshot"]
    assert snapshot["data"] is None and "snapshot unavailable" in snapshot["snapshot_error"]


@linux_only
def test_a_large_circuit_runs_lean_through_the_server(kernel) -> None:
    frames = send(kernel, execute(GHZ18, run_id="big1", seed=3))
    assert not error_codes(frames)
    result = [f for f in frames if f["type"] == "result"][0]
    assert sum(result["data"]["measurements"].values()) == 64
    assert result["data"]["truncated"]["state_vector"] is True


def test_lean_path_uses_the_adapter_aer_helpers(monkeypatch) -> None:
    """Above 16 qubits R-B's run_memory must call R-A's prepare_for_aer/run_on_aer, not its fallback."""
    from kernel.adapters import _qiskit_aer
    from kernel.executor import Executor

    calls: list[str] = []
    real_prepare, real_run = _qiskit_aer.prepare_for_aer, _qiskit_aer.run_on_aer
    monkeypatch.setattr(_qiskit_aer, "prepare_for_aer", lambda *a, **k: (calls.append("prepare"), real_prepare(*a, **k))[1])
    monkeypatch.setattr(_qiskit_aer, "run_on_aer", lambda *a, **k: (calls.append("run"), real_run(*a, **k))[1])
    result, _s, _o, _e, error = Executor().execute(GHZ18, 32, seed=1)
    assert error is None and result is not None
    assert "prepare" in calls and "run" in calls


def test_lean_path_runs_a_library_gate_circuit(monkeypatch) -> None:
    from kernel.executor import Executor

    code = (
        "from qiskit import QuantumCircuit\nfrom qiskit.circuit.library import QFT\n"
        "qc = QuantumCircuit(17, 17)\nqc.h(0)\nqc.append(QFT(17), range(17))\nqc.measure(range(17), range(17))\n"
    )
    result, _s, _o, _e, error = Executor().execute(code, 32, seed=1)
    assert error is None and sum(result.measurements.values()) == 32


def test_snapshot_failure_does_not_block_the_executor(monkeypatch) -> None:
    from kernel.adapters.qiskit_adapter import QiskitAdapter
    from kernel.executor import Executor

    def boom(self, circuit_obj, *, expand_blocks=False):
        raise RuntimeError("snapshot exploded")

    monkeypatch.setattr(QiskitAdapter, "extract_snapshot", boom)
    executor = Executor()
    result, snapshot, _o, _e, error = executor.execute(GHZ18.replace("18", "2"), 32, seed=1)
    assert error is None and snapshot is None and result is not None
    assert "snapshot unavailable" in executor.snapshot_error
