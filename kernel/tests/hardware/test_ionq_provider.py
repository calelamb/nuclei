"""IonQProvider tests — fully mocked, no qiskit-ionq required."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kernel.hardware.base import JobHandle
from kernel.hardware.ionq_provider import IonQProvider
from kernel.tests.hardware.conftest import assert_handle_failed


# ───────────────────────── connect() ─────────────────────────


def test_connect_missing_dependency_returns_false(block_sdk_import, capsys):
    block_sdk_import("qiskit_ionq")
    assert IonQProvider().connect({"token": "x"}) is False
    assert "qiskit-ionq" in capsys.readouterr().out


def test_connect_without_token_returns_false(install_fake_sdk, capsys):
    install_fake_sdk("qiskit_ionq", IonQProvider=MagicMock())
    assert IonQProvider().connect({}) is False
    assert "token" in capsys.readouterr().out.lower()


def test_connect_happy_path(install_fake_sdk):
    ionq_provider_instance = MagicMock()
    ionq_provider_instance.backends.return_value = [MagicMock()]
    FakeProvider = MagicMock(return_value=ionq_provider_instance)
    install_fake_sdk("qiskit_ionq", IonQProvider=FakeProvider)

    provider = IonQProvider()
    assert provider.connect({"token": "tok"}) is True
    assert provider._provider is ionq_provider_instance
    FakeProvider.assert_called_once_with("tok")


def test_connect_sdk_error_returns_false(install_fake_sdk, capsys):
    FakeProvider = MagicMock(side_effect=RuntimeError("401"))
    install_fake_sdk("qiskit_ionq", IonQProvider=FakeProvider)
    provider = IonQProvider()
    assert provider.connect({"token": "bad"}) is False
    assert provider._provider is None


# ───────────────────────── list_backends() ─────────────────────────


def _make_ionq_backend(name="ionq_simulator", n_qubits=29, pending=0, operational=True):
    be = MagicMock()
    be.name.return_value = name
    cfg = MagicMock()
    cfg.n_qubits = n_qubits
    cfg.coupling_map = None  # triggers all-to-all inference
    cfg.basis_gates = ["rx", "ry", "rxx"]
    be.configuration.return_value = cfg
    status = MagicMock()
    status.pending_jobs = pending
    status.operational = operational
    be.status.return_value = status
    return be


def test_list_backends_empty_when_disconnected():
    assert IonQProvider().list_backends() == []


def test_list_backends_infers_all_to_all_when_no_coupling_map():
    provider = IonQProvider()
    provider._provider = MagicMock()
    provider._provider.backends.return_value = [_make_ionq_backend(n_qubits=3)]
    backends = provider.list_backends()
    assert len(backends) == 1
    # 3-qubit all-to-all = 3*2 = 6 directed edges
    assert len(backends[0].connectivity) == 6
    assert backends[0].qubit_count == 3


def test_list_backends_marks_non_operational_as_maintenance():
    provider = IonQProvider()
    provider._provider = MagicMock()
    provider._provider.backends.return_value = [_make_ionq_backend(operational=False)]
    backends = provider.list_backends()
    assert backends[0].status == "maintenance"


# ───────────────────────── submit_job() ─────────────────────────


def test_submit_job_without_connection_raises():
    with pytest.raises(RuntimeError, match="not connected"):
        IonQProvider().submit_job(MagicMock(), "ionq_simulator", 1024)


def test_submit_job_happy_path():
    provider = IonQProvider()
    be = MagicMock()
    ionq_job = MagicMock()
    be.run.return_value = ionq_job
    provider._provider = MagicMock()
    provider._provider.get_backend.return_value = be

    circuit = MagicMock()
    handle = provider.submit_job(circuit, "ionq_simulator", 2048)
    assert handle.status == "queued"
    assert handle.error is None
    be.run.assert_called_once_with(circuit, shots=2048)
    assert handle.id in provider._jobs


def test_submit_job_failure_populates_error():
    provider = IonQProvider()
    provider._provider = MagicMock()
    provider._provider.get_backend.side_effect = RuntimeError("device not found")

    handle = provider.submit_job(MagicMock(), "mystery_device", 100)
    assert_handle_failed(handle, expected_error_contains=["device not found"])


# ───────────────────────── get_results() ─────────────────────────


def test_get_results_done_returns_counts():
    provider = IonQProvider()
    ionq_job = MagicMock()
    status = MagicMock(); status.name = "DONE"
    ionq_job.status.return_value = status
    result = MagicMock()
    result.get_counts.return_value = {"00": 400, "11": 624}
    ionq_job.result.return_value = result
    provider._jobs["j"] = ionq_job

    handle = JobHandle(id="j", provider="ionq", backend="x", status="queued",
                       queue_position=None, shots=1024, submitted_at="now")
    results = provider.get_results(handle)
    assert results["status"] == "complete"
    assert results["measurements"] == {"00": 400, "11": 624}


def test_get_results_handles_get_counts_exception():
    """SDK upgrade could change the result shape — provider degrades to empty
    counts rather than crashing."""
    provider = IonQProvider()
    ionq_job = MagicMock()
    status = MagicMock(); status.name = "DONE"
    ionq_job.status.return_value = status
    result = MagicMock()
    result.get_counts.side_effect = AttributeError("get_counts gone")
    ionq_job.result.return_value = result
    provider._jobs["j"] = ionq_job

    handle = JobHandle(id="j", provider="ionq", backend="x", status="queued",
                       queue_position=None, shots=1024, submitted_at="now")
    results = provider.get_results(handle)
    assert results["status"] == "complete"
    assert results["measurements"] == {}


def test_get_results_error_status():
    provider = IonQProvider()
    ionq_job = MagicMock()
    status = MagicMock(); status.name = "ERROR"
    ionq_job.status.return_value = status
    provider._jobs["j"] = ionq_job

    handle = JobHandle(id="j", provider="ionq", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    results = provider.get_results(handle)
    assert results["status"] == "failed"


def test_get_results_unknown_job_id():
    provider = IonQProvider()
    handle = JobHandle(id="nope", provider="ionq", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    results = provider.get_results(handle)
    assert "error" in results


# ───────────────────────── cancel_job() ─────────────────────────


def test_cancel_job_routes_to_sdk():
    provider = IonQProvider()
    ionq_job = MagicMock()
    provider._jobs["c"] = ionq_job
    handle = JobHandle(id="c", provider="ionq", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.cancel_job(handle) is True
    ionq_job.cancel.assert_called_once()


def test_cancel_swallows_sdk_error():
    provider = IonQProvider()
    ionq_job = MagicMock()
    ionq_job.cancel.side_effect = RuntimeError("nope")
    provider._jobs["c"] = ionq_job
    handle = JobHandle(id="c", provider="ionq", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.cancel_job(handle) is False
