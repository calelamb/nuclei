"""R-13 x R-11: when the diagram cannot be extracted the run still plans from the CIRCUIT, never from a blank stand-in."""

from __future__ import annotations

import pytest

from kernel import run_memory
from kernel.adapters.cirq_adapter import CirqAdapter
from kernel.adapters.qiskit_adapter import QiskitAdapter
from kernel.executor import Executor
from kernel.models import SimulationResult

GHZ_MEASURED = (
    "from qiskit import QuantumCircuit\nn = {n}\nqc = QuantumCircuit(n, n)\nqc.h(0)\n"
    "for q in range(1, n):\n    qc.cx(0, q)\nqc.measure(range(n), range(n))\n"
)
MID_CIRCUIT = (
    "from qiskit import QuantumCircuit\nqc = QuantumCircuit(18, 1)\nqc.h(0)\nqc.measure(0, 0)\nqc.h(1)\n"
)
CIRQ_MEASURED = (
    "import cirq\nqs = cirq.LineQubit.range(18)\n"
    "circuit = cirq.Circuit([cirq.H(qs[0])] + [cirq.CNOT(qs[0], q) for q in qs[1:]] + [cirq.measure(*qs, key='m')])\n"
)
BOUND = (
    "from qiskit import QuantumCircuit\nfrom qiskit.circuit import Parameter\n"
    "theta = Parameter('theta')\nqc = QuantumCircuit(1, 1)\nqc.ry(theta, 0)\nqc.measure(0, 0)\n"
)


def _boom(self, circuit_obj, *, expand_blocks=False):
    raise RuntimeError("snapshot exploded")


@pytest.fixture
def broken_snapshots(monkeypatch):
    monkeypatch.setattr(QiskitAdapter, "extract_snapshot", _boom)
    monkeypatch.setattr(CirqAdapter, "extract_snapshot", _boom)


def run(code: str, shots: int = 32, **kwargs):
    executor = Executor()
    result, snapshot, _o, _e, error = executor.execute(code, shots, seed=3, **kwargs)
    assert snapshot is None and "snapshot unavailable" in executor.snapshot_error
    return result, error


def test_measured_18_qubit_circuit_is_sampled_not_claimed_exact(broken_snapshots) -> None:
    result, error = run(GHZ_MEASURED.format(n=18))
    assert error is None
    assert result.measurements_source == "sampled" and result.probabilities_exact is False
    assert sum(result.measurements.values()) == 32


def test_mid_circuit_measurement_never_claims_exact(broken_snapshots) -> None:
    result, error = run(MID_CIRCUIT)
    assert error is None
    assert result.probabilities_exact is False and result.measurements_source == "sampled"


def test_cirq_measured_18_qubit_circuit_is_sampled(broken_snapshots) -> None:
    result, error = run(CIRQ_MEASURED)
    assert error is None and result.measurements_source == "sampled" and result.probabilities_exact is False


def test_refusal_estimate_counts_two_copies_and_offers_mps(broken_snapshots, monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 64 * (1 << 30))
    _result, error = run(GHZ_MEASURED.format(n=30))
    wire = error.to_dict()
    assert error.code == "too_many_qubits" and wire["estimate"]["copies"] == 2
    assert [a["id"] for a in wire["actions"]][0] == "rerun_mps"


def test_explicit_mps_method_is_honoured_when_the_snapshot_failed(broken_snapshots, monkeypatch) -> None:
    monkeypatch.setattr(run_memory, "physical_ram_bytes", lambda: 64 * (1 << 30))
    result, error = run(GHZ_MEASURED.format(n=30), simulation_method="matrix_product_state")
    assert error is None and result.measurements_source == "sampled"
    assert set(result.measurements) <= {"0" * 30, "1" * 30}


class _WideAdapter:
    """No ``num_qubits``/``all_qubits`` on its circuit: the width is unknowable from outside."""

    def __init__(self, n: int):
        self.n = n

    def simulate(self, circuit, shots, seed=None):
        return SimulationResult(
            state_vector=[{"re": 0.0, "im": 0.0}] * (2 ** self.n),
            probabilities={"0" * self.n: 1.0}, measurements={}, bloch_coords=[], execution_time_ms=1.0, shot_count=shots,
        )


class _Spec:
    framework = "cuda-q"


def test_unknown_width_adapter_result_is_shaped() -> None:
    result, error = Executor()._simulate(_Spec(), _WideAdapter(17), object(), None, 8, None, None, None)
    assert error is None
    wire = result.to_dict()
    assert wire["state_vector"] == [] and wire["truncated"]["state_vector"] is True


def test_unknown_width_small_result_is_left_alone() -> None:
    result, error = Executor()._simulate(_Spec(), _WideAdapter(2), object(), None, 8, None, None, None)
    assert error is None and len(result.state_vector) == 4 and not hasattr(result, "truncated")


def test_in_process_executor_carries_bound_at() -> None:
    result, _s, _o, _e, error = Executor().execute(BOUND, 16, parameter_values={"theta": 0.5})
    assert error is None and result.bound_at == {"theta": 0.5}
    assert result.to_dict()["bound_at"] == {"theta": 0.5}


def test_lean_result_carries_bound_at() -> None:
    code = GHZ_MEASURED.format(n=17).replace("qc.h(0)", "from qiskit.circuit import Parameter\nqc.ry(Parameter('t'), 0)")
    result, _s, _o, _e, error = Executor().execute(code, 16, seed=1, parameter_values={"t": 0.5})
    assert error is None and result.to_dict()["bound_at"] == {"t": 0.5}


def test_parse_degrades_like_run(broken_snapshots) -> None:
    executor = Executor()
    snapshot, _o, _e, error = executor.parse(GHZ_MEASURED.format(n=2))
    assert snapshot is None and error is None
    assert "snapshot unavailable" in executor.snapshot_error
