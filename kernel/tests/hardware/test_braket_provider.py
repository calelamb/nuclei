"""BraketProvider tests — fully mocked, no amazon-braket-sdk required.

Includes the ARN-not-found regression (PRD item 4) that must surface a
human-readable error on the returned JobHandle, not a silent 'failed'.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kernel.hardware.base import JobHandle
from kernel.hardware.braket_provider import BraketProvider
from kernel.tests.hardware.conftest import assert_handle_failed


# ───────────────────────── connect() ─────────────────────────


def test_connect_missing_dependency_returns_false(block_sdk_import, capsys):
    block_sdk_import("boto3")
    assert BraketProvider().connect({"access_key_id": "x", "secret_access_key": "y"}) is False
    out = capsys.readouterr().out
    assert "amazon-braket-sdk" in out or "boto3" in out


def test_connect_happy_path(install_fake_sdk):
    # boto3 + braket.aws (with AwsDevice) both need to import cleanly.
    client = MagicMock()
    client.search_devices.return_value = {}
    session = MagicMock()
    session.client.return_value = client
    boto3 = install_fake_sdk("boto3", Session=MagicMock(return_value=session))
    install_fake_sdk("braket.aws", AwsDevice=MagicMock())

    provider = BraketProvider()
    ok = provider.connect({
        "access_key_id": "a",
        "secret_access_key": "b",
        "region": "us-west-2",
    })
    assert ok is True
    assert provider._aws_session is session
    # Passes region through.
    kwargs = boto3.Session.call_args.kwargs
    assert kwargs["region_name"] == "us-west-2"


def test_connect_validates_with_search_devices_call(install_fake_sdk, capsys):
    client = MagicMock()
    client.search_devices.side_effect = RuntimeError("InvalidClientTokenId")
    session = MagicMock()
    session.client.return_value = client
    install_fake_sdk("boto3", Session=MagicMock(return_value=session))
    install_fake_sdk("braket.aws", AwsDevice=MagicMock())

    provider = BraketProvider()
    assert provider.connect({"access_key_id": "a", "secret_access_key": "b"}) is False
    assert provider._aws_session is None
    assert "InvalidClientTokenId" in capsys.readouterr().out


# ───────────────────────── list_backends() ─────────────────────────


def test_list_backends_empty_when_disconnected():
    assert BraketProvider().list_backends() == []


def test_list_backends_maps_devices_and_caches_arns(install_fake_sdk):
    # Mock AwsDevice.get_devices to return two devices
    device_a = MagicMock()
    device_a.arn = "arn:aws:braket:::device/quantum-simulator/amazon/sv1"
    device_a.name = "SV1"
    device_a.properties.paradigm.qubitCount = 34
    device_a.properties.paradigm.connectivity.connectivityGraph = {}
    device_a.status = "ONLINE"

    device_b = MagicMock()
    device_b.arn = "arn:aws:braket:::device/qpu/ionq/Aria-1"
    device_b.name = "Aria-1"
    device_b.properties.paradigm.qubitCount = 25
    device_b.properties.paradigm.connectivity.connectivityGraph = {"0": ["1"], "1": ["0"]}
    device_b.status = "ONLINE"

    FakeAwsDevice = MagicMock()
    FakeAwsDevice.get_devices.return_value = [device_a, device_b]
    FakeAwsSession = MagicMock()
    install_fake_sdk("braket.aws", AwsDevice=FakeAwsDevice)
    install_fake_sdk("braket.aws.aws_session", AwsSession=FakeAwsSession)

    provider = BraketProvider()
    provider._aws_session = MagicMock()  # pretend connected
    backends = provider.list_backends()

    assert len(backends) == 2
    assert {b.name for b in backends} == {"SV1", "Aria-1"}
    assert provider._device_arns["Aria-1"] == "arn:aws:braket:::device/qpu/ionq/Aria-1"
    aria = next(b for b in backends if b.name == "Aria-1")
    assert (0, 1) in aria.connectivity


# ───────────────────────── submit_job() ─────────────────────────


def test_submit_job_requires_connection():
    with pytest.raises(RuntimeError, match="not connected"):
        BraketProvider().submit_job(MagicMock(), "SV1", 100)


def test_submit_job_arn_not_in_cache_returns_friendly_error(install_fake_sdk):
    """PRD item 4: unknown backend name → JobHandle with populated .error,
    not a silent failure. The frontend should show the user a hint to
    refresh the backend list."""
    install_fake_sdk("braket.aws", AwsDevice=MagicMock())
    install_fake_sdk("braket.aws.aws_session", AwsSession=MagicMock())
    provider = BraketProvider()
    provider._aws_session = MagicMock()

    handle = provider.submit_job(MagicMock(), "SomeRetiredDevice", 100)
    assert_handle_failed(handle, expected_error_contains=["SomeRetiredDevice"])
    assert "refresh" in (handle.error or "").lower()


def test_submit_job_happy_path(install_fake_sdk, sample_circuit):
    device = MagicMock()
    task = MagicMock()
    device.run.return_value = task
    FakeAwsDevice = MagicMock(return_value=device)
    FakeAwsSession = MagicMock()
    install_fake_sdk("braket.aws", AwsDevice=FakeAwsDevice)
    install_fake_sdk("braket.aws.aws_session", AwsSession=FakeAwsSession)

    provider = BraketProvider()
    provider._aws_session = MagicMock()
    provider._device_arns["SV1"] = "arn:aws:braket:::device/quantum-simulator/amazon/sv1"

    handle = provider.submit_job(sample_circuit, "SV1", 1000)
    assert handle.status == "queued"
    assert handle.error is None
    device.run.assert_called_once_with(sample_circuit, shots=1000)


def test_submit_job_run_exception_populates_error(install_fake_sdk, sample_circuit):
    device = MagicMock()
    device.run.side_effect = RuntimeError("circuit requires a transpile step")
    FakeAwsDevice = MagicMock(return_value=device)
    install_fake_sdk("braket.aws", AwsDevice=FakeAwsDevice)
    install_fake_sdk("braket.aws.aws_session", AwsSession=MagicMock())

    provider = BraketProvider()
    provider._aws_session = MagicMock()
    provider._device_arns["SV1"] = "arn:x"

    handle = provider.submit_job(sample_circuit, "SV1", 100)
    assert_handle_failed(handle, expected_error_contains=["transpile"])


# ───────────────────────── get_results() ─────────────────────────


def test_get_results_completed_returns_measurements():
    provider = BraketProvider()
    task = MagicMock()
    task.state.return_value = "COMPLETED"
    result = MagicMock()
    result.measurement_counts = {"00": 512, "11": 512}
    task.result.return_value = result
    provider._jobs["j"] = task

    handle = JobHandle(id="j", provider="braket", backend="x", status="queued",
                       queue_position=None, shots=1024, submitted_at="now")
    results = provider.get_results(handle)
    assert results["status"] == "complete"
    assert results["measurements"] == {"00": 512, "11": 512}


def test_get_results_measurement_counts_variant_shape():
    """Some Braket providers return Counter-like objects — provider coerces
    them to plain dict."""
    provider = BraketProvider()
    task = MagicMock()
    task.state.return_value = "COMPLETED"
    result = MagicMock()
    # Counter-style: iterable of (key, value) pairs instead of dict
    from collections import Counter
    result.measurement_counts = Counter({"00": 400, "01": 100})
    task.result.return_value = result
    provider._jobs["j"] = task

    handle = JobHandle(id="j", provider="braket", backend="x", status="queued",
                       queue_position=None, shots=500, submitted_at="now")
    results = provider.get_results(handle)
    assert dict(results["measurements"]) == {"00": 400, "01": 100}


def test_get_results_failed_and_running_paths():
    provider = BraketProvider()
    task = MagicMock()
    task.state.return_value = "FAILED"
    provider._jobs["f"] = task

    handle = JobHandle(id="f", provider="braket", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.get_results(handle)["status"] == "failed"

    task.state.return_value = "RUNNING"
    assert provider.get_results(handle)["status"] == "running"


def test_get_results_unknown_job():
    provider = BraketProvider()
    handle = JobHandle(id="m", provider="braket", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    results = provider.get_results(handle)
    assert "error" in results


# ───────────────────────── cancel ─────────────────────────


def test_cancel_happy_path():
    provider = BraketProvider()
    task = MagicMock()
    provider._jobs["c"] = task
    handle = JobHandle(id="c", provider="braket", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.cancel_job(handle) is True
    task.cancel.assert_called_once()


def test_cancel_unknown_job_returns_true():
    provider = BraketProvider()
    handle = JobHandle(id="nope", provider="braket", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.cancel_job(handle) is True
