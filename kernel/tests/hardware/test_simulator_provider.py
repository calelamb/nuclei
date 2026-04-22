"""SimulatorProvider tests — runs the real Executor with no external SDKs.

The simulator is our reference path: every other provider can be mocked, but
the simulator is what actually executes student code when they're not
connected to real hardware. Happy paths + error paths are both covered.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from kernel.hardware.base import JobHandle
from kernel.hardware.simulator_provider import SIMULATED_BACKENDS, SimulatorProvider
from kernel.models import KernelError, SimulationResult


def test_connect_is_always_true():
    # Simulator has no credentials and no auth — connect is a no-op that
    # always succeeds so the frontend can list backends immediately on boot.
    assert SimulatorProvider().connect({}) is True


def test_list_backends_returns_builtin_catalog():
    backends = SimulatorProvider().list_backends()
    assert len(backends) == len(SIMULATED_BACKENDS)
    names = {b.name for b in backends}
    assert names == {"sim_qasm", "sim_statevector", "sim_noise"}
    for be in backends:
        assert be.provider == "simulator"
        assert be.status == "online"
        assert be.qubit_count >= 20


def test_submit_job_happy_path_with_string_code_returns_complete(monkeypatch):
    provider = SimulatorProvider()
    result_payload = SimulationResult(
        state_vector=[{"re": 1.0, "im": 0.0}],
        probabilities={"00": 1.0},
        measurements={"00": 1024},
        bloch_coords=[{"x": 0.0, "y": 0.0, "z": 1.0}],
        execution_time_ms=2.0,
        shot_count=1024,
    )
    mock_execute = MagicMock(return_value=(result_payload, None, "", "", None))
    monkeypatch.setattr(provider._executor, "execute", mock_execute)

    handle = provider.submit_job(
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)",
        "sim_qasm",
        1024,
    )

    assert isinstance(handle, JobHandle)
    assert handle.status == "complete"
    assert handle.provider == "simulator"
    assert handle.backend == "sim_qasm"
    assert handle.shots == 1024
    # Executor was called with the code string and shots.
    args, _ = mock_execute.call_args
    assert args[0].startswith("from qiskit")
    assert args[1] == 1024

    results = provider.get_results(handle)
    assert results["probabilities"] == {"00": 1.0}


def test_submit_job_propagates_executor_error_into_failed_handle(monkeypatch):
    provider = SimulatorProvider()
    kernel_error = KernelError(
        code="execution_error",
        message="ZeroDivisionError: division by zero",
        traceback="Traceback...\nZeroDivisionError: division by zero\n",
    )
    mock_execute = MagicMock(return_value=(None, None, "", "", kernel_error))
    monkeypatch.setattr(provider._executor, "execute", mock_execute)

    handle = provider.submit_job("1/0", "sim_qasm", 256)

    assert handle.status == "failed"
    # Results contain the underlying kernel error dict.
    results = provider.get_results(handle)
    assert "error" in results
    assert "ZeroDivisionError" in results["error"]["message"]


def test_submit_job_with_non_string_circuit_object_runs_empty_code(monkeypatch):
    """When the frontend passes a framework object (not raw code), the
    simulator can't execute it directly, so it runs empty code — the result
    is a zero-gate circuit error surfaced via the executor."""
    provider = SimulatorProvider()
    mock_execute = MagicMock(return_value=(None, None, "", "", KernelError(
        code="unsupported_framework",
        message="No supported quantum framework detected in code.",
    )))
    monkeypatch.setattr(provider._executor, "execute", mock_execute)

    handle = provider.submit_job(MagicMock(), "sim_qasm", 100)

    # First positional arg to execute is empty string.
    args, _ = mock_execute.call_args
    assert args[0] == ""
    assert handle.status == "failed"


def test_get_queue_position_always_zero():
    # No queue on the local simulator.
    provider = SimulatorProvider()
    handle = JobHandle(
        id="x",
        provider="simulator",
        backend="sim_qasm",
        status="queued",
        queue_position=None,
        shots=1,
        submitted_at="now",
    )
    assert provider.get_queue_position(handle) == 0


def test_get_results_for_unknown_job_returns_empty_dict():
    # Asymmetric with real providers (which return {"error": ...}) — the
    # simulator's in-memory map is local and short-lived so an unknown
    # id is just "we haven't run that yet".
    provider = SimulatorProvider()
    handle = JobHandle(
        id="never-submitted",
        provider="simulator",
        backend="sim_qasm",
        status="queued",
        queue_position=None,
        shots=1,
        submitted_at="now",
    )
    assert provider.get_results(handle) == {}


def test_cancel_job_is_noop_returning_true():
    # Simulator completes synchronously; there's nothing to cancel.
    provider = SimulatorProvider()
    handle = JobHandle(
        id="x",
        provider="simulator",
        backend="sim_qasm",
        status="queued",
        queue_position=None,
        shots=1,
        submitted_at="now",
    )
    assert provider.cancel_job(handle) is True
