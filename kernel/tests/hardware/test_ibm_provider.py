"""IBMProvider tests — fully mocked, no qiskit-ibm-runtime required.

Exercises connect (happy/fail/missing-dep), list_backends, submit (happy and
rejection with error propagation), get_results across realistic SamplerV2
shapes, get_queue_position, and cancel. Also locks in the fix for the
`job.status()` uncaught-exception bug (PRD item 5).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kernel.hardware.base import JobHandle
from kernel.hardware.ibm_provider import IBMProvider
from kernel.tests.hardware.conftest import assert_handle_failed


# ───────────────────────── connect() ─────────────────────────


def test_connect_missing_dependency_returns_false(block_sdk_import, capsys):
    """When qiskit-ibm-runtime isn't installed, connect() returns False and
    prints a clear install hint (matches the ionq_provider.py pattern)."""
    block_sdk_import("qiskit_ibm_runtime")
    provider = IBMProvider()
    assert provider.connect({"token": "x"}) is False
    captured = capsys.readouterr()
    assert "qiskit-ibm-runtime" in captured.out


def test_connect_happy_path_populates_service(install_fake_sdk):
    service_instance = MagicMock(name="QiskitRuntimeService")
    FakeService = MagicMock(return_value=service_instance)
    install_fake_sdk("qiskit_ibm_runtime", QiskitRuntimeService=FakeService)

    provider = IBMProvider()
    assert provider.connect({"token": "tok", "instance": "ibm-q/open/main"}) is True
    assert provider._service is service_instance
    FakeService.assert_called_once_with(
        channel="ibm_quantum",
        token="tok",
        instance="ibm-q/open/main",
    )


def test_connect_service_constructor_error_returns_false(install_fake_sdk, capsys):
    FakeService = MagicMock(side_effect=RuntimeError("401 unauthorized"))
    install_fake_sdk("qiskit_ibm_runtime", QiskitRuntimeService=FakeService)

    provider = IBMProvider()
    assert provider.connect({"token": "bad"}) is False
    assert provider._service is None
    captured = capsys.readouterr()
    assert "401 unauthorized" in captured.out


# ───────────────────────── list_backends() ─────────────────────────


def _make_ibm_backend(name="ibm_brisbane", qubits=127, coupling=None, pending=5, operational=True):
    """Shape matching the qiskit-ibm-runtime backend return type."""
    be = MagicMock(name=name)
    config = MagicMock()
    config.backend_name = name
    config.n_qubits = qubits
    config.coupling_map = coupling or [[0, 1], [1, 2]]
    config.basis_gates = ["cx", "id", "rz", "sx", "x"]
    be.configuration.return_value = config

    # Properties / gate-errors
    props = MagicMock()
    gate = MagicMock()
    param = MagicMock()
    param.value = 0.005
    gate.parameters = [param]
    props.gates = [gate]
    be.properties.return_value = props

    status = MagicMock()
    status.operational = operational
    status.status_msg = "active" if operational else "maintenance"
    status.pending_jobs = pending
    be.status.return_value = status
    return be


def test_list_backends_empty_when_disconnected():
    assert IBMProvider().list_backends() == []


def test_list_backends_maps_sdk_shape_to_BackendInfo():
    provider = IBMProvider()
    be1 = _make_ibm_backend("ibm_brisbane", qubits=127, pending=10)
    provider._service = MagicMock()
    provider._service.backends.return_value = [be1]

    backends = provider.list_backends()
    assert len(backends) == 1
    assert backends[0].name == "ibm_brisbane"
    assert backends[0].qubit_count == 127
    assert backends[0].queue_length == 10
    assert backends[0].status == "online"
    # Gate set and connectivity are copied through from the SDK.
    assert "cx" in backends[0].gate_set
    assert (0, 1) in backends[0].connectivity


def test_list_backends_skips_backends_that_raise(capsys):
    provider = IBMProvider()
    broken = MagicMock()
    broken.configuration.side_effect = RuntimeError("busted")
    broken.name = "broken_backend"
    good = _make_ibm_backend("ibm_torino", qubits=133)
    provider._service = MagicMock()
    provider._service.backends.return_value = [broken, good]

    backends = provider.list_backends()
    assert len(backends) == 1
    assert backends[0].name == "ibm_torino"


# ───────────────────────── submit_job() ─────────────────────────


def test_submit_job_without_service_raises_runtime_error():
    with pytest.raises(RuntimeError, match="not connected"):
        IBMProvider().submit_job(MagicMock(), "ibm_brisbane", 1024)


def test_submit_job_happy_path_returns_queued_handle(install_fake_sdk, sample_circuit):
    sampler_instance = MagicMock(name="Sampler")
    ibm_job = MagicMock(name="ibm_job")
    sampler_instance.run.return_value = ibm_job

    FakeSampler = MagicMock(return_value=sampler_instance)
    fake_transpile = MagicMock(return_value="transpiled-circuit")
    install_fake_sdk("qiskit_ibm_runtime", SamplerV2=FakeSampler)
    install_fake_sdk("qiskit.compiler", transpile=fake_transpile)

    provider = IBMProvider()
    backend_obj = MagicMock()
    provider._service = MagicMock()
    provider._service.backend.return_value = backend_obj

    handle = provider.submit_job(sample_circuit, "ibm_brisbane", 2048)
    assert handle.status == "queued"
    assert handle.provider == "ibm"
    assert handle.backend == "ibm_brisbane"
    assert handle.shots == 2048
    assert handle.error is None
    # SDK calls happened as expected.
    fake_transpile.assert_called_once_with(sample_circuit, backend=backend_obj)
    FakeSampler.assert_called_once_with(backend_obj)
    sampler_instance.run.assert_called_once_with(["transpiled-circuit"], shots=2048)
    # Handle is registered for later polling.
    assert handle.id in provider._jobs


def test_submit_job_failure_carries_error_message(install_fake_sdk, sample_circuit):
    """The PRD requires submit failures to populate handle.error with the
    underlying SDK error — not a generic 'submit failed' string."""
    install_fake_sdk("qiskit_ibm_runtime", SamplerV2=MagicMock())
    install_fake_sdk(
        "qiskit.compiler",
        transpile=MagicMock(side_effect=RuntimeError("circuit exceeds backend qubit count")),
    )

    provider = IBMProvider()
    provider._service = MagicMock()
    provider._service.backend.return_value = MagicMock()

    handle = provider.submit_job(sample_circuit, "ibm_brisbane", 1024)
    assert_handle_failed(handle, expected_error_contains=["circuit exceeds"])


# ───────────────────────── get_results() ─────────────────────────


def _install_sampler_result(counts: dict[str, int]) -> MagicMock:
    """Mock shaped like SamplerV2 result: result()[0].data.<creg>.get_counts()."""
    pub_result = MagicMock()
    data = MagicMock()
    creg = MagicMock()
    creg.get_counts.return_value = counts
    # data iterates to ["c"]; pub_result.data.c returns creg
    data.__iter__ = lambda self: iter(["c"])
    setattr(data, "c", creg)
    pub_result.data = data
    return pub_result


def test_get_results_done_returns_flattened_counts(install_fake_sdk):
    install_fake_sdk("qiskit_ibm_runtime", RuntimeJobV2=MagicMock())
    provider = IBMProvider()
    ibm_job = MagicMock()
    status = MagicMock()
    status.name = "DONE"
    ibm_job.status.return_value = status
    ibm_job.result.return_value = [_install_sampler_result({"00": 512, "11": 512})]
    provider._jobs["nuc-1"] = ibm_job

    handle = JobHandle(
        id="nuc-1", provider="ibm", backend="ibm_brisbane",
        status="queued", queue_position=None, shots=1024, submitted_at="now",
    )
    results = provider.get_results(handle)
    assert results["status"] == "complete"
    assert results["measurements"] == {"00": 512, "11": 512}


def test_get_results_handles_multi_creg_shape(install_fake_sdk):
    """A circuit with multiple classical registers returns counts under each
    register name; provider flattens them into a single dict."""
    install_fake_sdk("qiskit_ibm_runtime", RuntimeJobV2=MagicMock())
    provider = IBMProvider()

    pub_result = MagicMock()
    data = MagicMock()
    alpha, beta = MagicMock(), MagicMock()
    alpha.get_counts.return_value = {"0": 400}
    beta.get_counts.return_value = {"1": 624}
    data.__iter__ = lambda self: iter(["alpha", "beta"])
    setattr(data, "alpha", alpha)
    setattr(data, "beta", beta)
    pub_result.data = data

    ibm_job = MagicMock()
    status = MagicMock(); status.name = "DONE"
    ibm_job.status.return_value = status
    ibm_job.result.return_value = [pub_result]
    provider._jobs["multi"] = ibm_job

    handle = JobHandle(
        id="multi", provider="ibm", backend="ibm_torino",
        status="queued", queue_position=None, shots=1024, submitted_at="now",
    )
    results = provider.get_results(handle)
    # Both registers' counts flattened into one dict.
    assert results["measurements"] == {"0": 400, "1": 624}


def test_get_results_error_status_returns_failed(install_fake_sdk):
    install_fake_sdk("qiskit_ibm_runtime", RuntimeJobV2=MagicMock())
    provider = IBMProvider()
    ibm_job = MagicMock()
    status = MagicMock(); status.name = "ERROR"
    ibm_job.status.return_value = status
    provider._jobs["e"] = ibm_job

    handle = JobHandle(
        id="e", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    results = provider.get_results(handle)
    assert results["status"] == "failed"
    assert "ERROR" in results["error"]


def test_get_results_running_status_returns_running(install_fake_sdk):
    install_fake_sdk("qiskit_ibm_runtime", RuntimeJobV2=MagicMock())
    provider = IBMProvider()
    ibm_job = MagicMock()
    status = MagicMock(); status.name = "QUEUED"
    ibm_job.status.return_value = status
    provider._jobs["q"] = ibm_job

    handle = JobHandle(
        id="q", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    results = provider.get_results(handle)
    assert results["status"] == "running"


def test_get_results_survives_status_exception_as_unknown(install_fake_sdk):
    """PRD item 5: status() throwing (e.g. deleted on IBM side) must NOT
    crash the polling loop. The provider returns status=='unknown' so the
    frontend can show a neutral state rather than flashing 'failed', and
    includes the underlying error for debugging."""
    install_fake_sdk("qiskit_ibm_runtime", RuntimeJobV2=MagicMock())
    provider = IBMProvider()
    ibm_job = MagicMock()
    ibm_job.status.side_effect = RuntimeError("job deleted on server side")
    provider._jobs["gone"] = ibm_job

    handle = JobHandle(
        id="gone", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    results = provider.get_results(handle)
    assert results.get("status") == "unknown", results
    assert "deleted" in results.get("error", "").lower()


def test_get_results_unknown_job_id_returns_error():
    provider = IBMProvider()
    handle = JobHandle(
        id="mystery", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    results = provider.get_results(handle)
    assert "error" in results
    assert "mystery" in results["error"]


# ───────────────────────── get_queue_position() ─────────────────────────


def test_get_queue_position_reads_from_sdk():
    provider = IBMProvider()
    ibm_job = MagicMock()
    queue_info = MagicMock()
    queue_info.position = 17
    ibm_job.queue_info.return_value = queue_info
    provider._jobs["p"] = ibm_job

    handle = JobHandle(
        id="p", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    assert provider.get_queue_position(handle) == 17


def test_get_queue_position_unknown_job_returns_negative_one():
    provider = IBMProvider()
    handle = JobHandle(
        id="x", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    assert provider.get_queue_position(handle) == -1


# ───────────────────────── cancel_job() ─────────────────────────


def test_cancel_job_calls_sdk_cancel():
    provider = IBMProvider()
    ibm_job = MagicMock()
    provider._jobs["c"] = ibm_job

    handle = JobHandle(
        id="c", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    assert provider.cancel_job(handle) is True
    ibm_job.cancel.assert_called_once()


def test_cancel_job_swallows_sdk_exception():
    provider = IBMProvider()
    ibm_job = MagicMock()
    ibm_job.cancel.side_effect = RuntimeError("cancel not permitted")
    provider._jobs["c"] = ibm_job

    handle = JobHandle(
        id="c", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    assert provider.cancel_job(handle) is False


def test_cancel_job_unknown_id_returns_true():
    """Unknown ID is treated as already-gone — the UI can flip to a clean
    state without needing a round trip."""
    provider = IBMProvider()
    handle = JobHandle(
        id="never-existed", provider="ibm", backend="x",
        status="queued", queue_position=None, shots=1, submitted_at="now",
    )
    assert provider.cancel_job(handle) is True
