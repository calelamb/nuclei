"""AzureProvider tests — fully mocked, no azure-quantum required.

Locks in the fix for workspace.get_targets returning None or list (PRD
item 3) with dedicated tests for each shape.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kernel.hardware.base import JobHandle
from kernel.hardware.azure_provider import AzureProvider
from kernel.tests.hardware.conftest import assert_handle_failed


# ───────────────────────── connect() ─────────────────────────


def test_connect_missing_dependency_returns_false(block_sdk_import, capsys):
    block_sdk_import("azure.quantum")
    ok = AzureProvider().connect({
        "subscription_id": "a",
        "resource_group": "b",
        "workspace_name": "c",
    })
    assert ok is False
    assert "azure-quantum" in capsys.readouterr().out


def test_connect_happy_path(install_fake_sdk):
    workspace = MagicMock()
    workspace.get_targets.return_value = [MagicMock()]
    FakeWorkspace = MagicMock(return_value=workspace)
    install_fake_sdk("azure.quantum", Workspace=FakeWorkspace)

    provider = AzureProvider()
    ok = provider.connect({
        "subscription_id": "sub",
        "resource_group": "rg",
        "workspace_name": "ws",
        "location": "westus",
    })
    assert ok is True
    assert provider._workspace is workspace
    FakeWorkspace.assert_called_once_with(
        subscription_id="sub",
        resource_group="rg",
        name="ws",
        location="westus",
    )


def test_connect_requires_identifiers(install_fake_sdk, capsys):
    install_fake_sdk("azure.quantum", Workspace=MagicMock())
    ok = AzureProvider().connect({})
    assert ok is False
    out = capsys.readouterr().out.lower()
    assert "subscription_id" in out or "resource_group" in out or "workspace_name" in out


# ───────────────────────── list_backends() ─────────────────────────


def test_list_backends_empty_when_disconnected():
    assert AzureProvider().list_backends() == []


def test_list_backends_infers_qubit_counts_from_provider_prefix():
    provider = AzureProvider()
    target_q = MagicMock()
    target_q.name = "quantinuum.qpu.h1-1"
    target_q.current_availability = "Available"
    target_q.average_queue_time = 30
    target_i = MagicMock()
    target_i.name = "ionq.qpu.aria-1"
    target_i.current_availability = "Available"
    target_i.average_queue_time = 5
    workspace = MagicMock()
    workspace.get_targets.return_value = [target_q, target_i]
    provider._workspace = workspace

    backends = provider.list_backends()
    qb = {b.name: b.qubit_count for b in backends}
    assert qb["quantinuum.qpu.h1-1"] == 56
    assert qb["ionq.qpu.aria-1"] == 29


# ───────────────────────── submit_job() — None / list handling ─────────────────────────


def test_submit_job_requires_connection():
    with pytest.raises(RuntimeError, match="not connected"):
        AzureProvider().submit_job(MagicMock(), "x", 100)


def test_submit_job_with_single_target_object_is_happy_path(sample_circuit):
    """When workspace.get_targets(name=...) returns a Target object directly,
    provider submits to it straight."""
    provider = AzureProvider()
    target = MagicMock()
    azure_job = MagicMock()
    target.submit.return_value = azure_job
    workspace = MagicMock()
    workspace.get_targets.return_value = target  # single object, not list
    provider._workspace = workspace

    handle = provider.submit_job(sample_circuit, "quantinuum.qpu.h1-1", 500)
    assert handle.status == "queued"
    assert handle.error is None
    target.submit.assert_called_once_with(sample_circuit, shots=500)


def test_submit_job_with_list_of_one_target_unwraps_and_submits(sample_circuit):
    """Some Azure SDK versions return a list even when filtering by name.
    Provider takes element [0]."""
    provider = AzureProvider()
    target = MagicMock()
    target.submit.return_value = MagicMock()
    workspace = MagicMock()
    workspace.get_targets.return_value = [target]  # list shape
    provider._workspace = workspace

    handle = provider.submit_job(sample_circuit, "target.x", 100)
    assert handle.status == "queued"
    assert handle.error is None
    target.submit.assert_called_once()


def test_submit_job_returns_none_surfaces_readable_error(sample_circuit):
    """PRD item 3: workspace.get_targets(name=...) can return None — the
    previous code blew up with AttributeError on .submit()."""
    provider = AzureProvider()
    workspace = MagicMock()
    workspace.get_targets.return_value = None
    provider._workspace = workspace

    handle = provider.submit_job(sample_circuit, "does.not.exist", 100)
    assert_handle_failed(handle, expected_error_contains=["does.not.exist"])


def test_submit_job_empty_list_surfaces_readable_error(sample_circuit):
    """Empty list (no matches) must also be treated as a not-found case."""
    provider = AzureProvider()
    workspace = MagicMock()
    workspace.get_targets.return_value = []
    provider._workspace = workspace

    handle = provider.submit_job(sample_circuit, "phantom", 1)
    assert_handle_failed(handle, expected_error_contains=["phantom"])


def test_submit_job_target_submit_exception_populates_error(sample_circuit):
    provider = AzureProvider()
    target = MagicMock()
    target.submit.side_effect = RuntimeError("quota exceeded")
    workspace = MagicMock()
    workspace.get_targets.return_value = target
    provider._workspace = workspace

    handle = provider.submit_job(sample_circuit, "x", 1)
    assert_handle_failed(handle, expected_error_contains=["quota"])


# ───────────────────────── get_results() ─────────────────────────


def test_get_results_succeeded_returns_counts():
    provider = AzureProvider()
    azure_job = MagicMock()
    details = MagicMock()
    details.status = "Succeeded"
    azure_job.details = details
    azure_job.get_results.return_value = {"00": 512, "11": 512}
    provider._jobs["j"] = azure_job

    handle = JobHandle(id="j", provider="azure", backend="x", status="queued",
                       queue_position=None, shots=1024, submitted_at="now")
    results = provider.get_results(handle)
    assert results["status"] == "complete"
    assert results["measurements"] == {"00": 512, "11": 512}


def test_get_results_failed_cancelled_and_running_paths():
    provider = AzureProvider()
    azure_job = MagicMock()
    details = MagicMock()
    azure_job.details = details

    details.status = "Failed"
    provider._jobs["j"] = azure_job
    handle = JobHandle(id="j", provider="azure", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.get_results(handle)["status"] == "failed"

    details.status = "Executing"
    assert provider.get_results(handle)["status"] == "running"


def test_get_results_unknown_job():
    provider = AzureProvider()
    handle = JobHandle(id="x", provider="azure", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert "error" in provider.get_results(handle)


# ───────────────────────── cancel ─────────────────────────


def test_cancel_routes_to_sdk():
    provider = AzureProvider()
    azure_job = MagicMock()
    provider._jobs["c"] = azure_job
    handle = JobHandle(id="c", provider="azure", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.cancel_job(handle) is True
    azure_job.cancel.assert_called_once()


def test_cancel_unknown_returns_true():
    provider = AzureProvider()
    handle = JobHandle(id="nope", provider="azure", backend="x", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert provider.cancel_job(handle) is True
