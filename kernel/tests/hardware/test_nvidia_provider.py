"""NvidiaProvider tests — fully mocked, no cudaq required.

CUDA-Q is a local simulator (no queue, no remote state), so behavior is
mostly about surfacing SDK errors clearly. No submit_job() failure path
test because the provider returns status='failed' + stores error in the
results dict rather than on JobHandle.error (simulator-style). Those
tests assert the status + results contract instead.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kernel.hardware.base import JobHandle
from kernel.hardware.nvidia_provider import NvidiaProvider


def test_connect_missing_dependency_returns_false(block_sdk_import, capsys):
    block_sdk_import("cudaq")
    assert NvidiaProvider().connect({}) is False
    assert "cudaq" in capsys.readouterr().out


def test_connect_populates_target_catalog(install_fake_sdk):
    install_fake_sdk("cudaq", get_target_names=MagicMock(return_value=["nvidia", "qpp-cpu"]))
    provider = NvidiaProvider()
    assert provider.connect({}) is True
    assert "nvidia" in provider._targets
    assert "qpp-cpu" in provider._targets


def test_list_backends_filters_to_available_targets(install_fake_sdk):
    # cudaq reports only 'nvidia' and 'qpp-cpu' are available; the other two
    # catalog entries must be filtered out.
    install_fake_sdk("cudaq", get_target_names=MagicMock(return_value={"nvidia", "qpp-cpu"}))
    provider = NvidiaProvider()
    provider.connect({})
    backends = provider.list_backends()
    names = {b.name for b in backends}
    assert names == {"nvidia", "qpp-cpu"}


def test_list_backends_empty_when_not_connected():
    assert NvidiaProvider().list_backends() == []


def test_submit_job_happy_path(install_fake_sdk):
    sample_result = MagicMock()
    sample_result.items.return_value = [("00", 600), ("11", 424)]
    cudaq = install_fake_sdk(
        "cudaq",
        get_target_names=MagicMock(return_value={"nvidia"}),
        set_target=MagicMock(),
        sample=MagicMock(return_value=sample_result),
    )
    provider = NvidiaProvider()
    provider.connect({})

    kernel = MagicMock()
    handle = provider.submit_job(kernel, "nvidia", 1024)

    assert handle.status == "complete"
    cudaq.set_target.assert_called_once_with("nvidia")
    cudaq.sample.assert_called_once_with(kernel, shots_count=1024)

    results = provider.get_results(handle)
    assert results["measurements"] == {"00": 600, "11": 424}


def test_submit_job_unknown_backend_fails(install_fake_sdk):
    install_fake_sdk("cudaq", get_target_names=MagicMock(return_value={"nvidia"}))
    provider = NvidiaProvider()
    provider.connect({})

    handle = provider.submit_job(MagicMock(), "does-not-exist", 100)
    assert handle.status == "failed"
    # Error is surfaced via the results dict for this provider shape.
    results = provider.get_results(handle)
    assert "error" in results
    assert "does-not-exist" in results["error"]


def test_submit_job_kernel_tuple_unpacks_args(install_fake_sdk):
    """The adapter layer can pass (kernel, *args) — CUDA-Q samples with the
    args forwarded."""
    sample_result = MagicMock()
    sample_result.items.return_value = [("0", 1000)]
    cudaq = install_fake_sdk(
        "cudaq",
        get_target_names=MagicMock(return_value={"nvidia"}),
        set_target=MagicMock(),
        sample=MagicMock(return_value=sample_result),
    )
    provider = NvidiaProvider()
    provider.connect({})
    kernel = MagicMock()
    handle = provider.submit_job((kernel, 1.5, "hello"), "nvidia", 500)
    cudaq.sample.assert_called_once_with(kernel, 1.5, "hello", shots_count=500)
    assert handle.status == "complete"


def test_submit_job_sample_exception_goes_to_failed(install_fake_sdk):
    install_fake_sdk(
        "cudaq",
        get_target_names=MagicMock(return_value={"nvidia"}),
        set_target=MagicMock(),
        sample=MagicMock(side_effect=RuntimeError("no GPU available")),
    )
    provider = NvidiaProvider()
    provider.connect({})
    handle = provider.submit_job(MagicMock(), "nvidia", 1)
    assert handle.status == "failed"
    results = provider.get_results(handle)
    assert "GPU" in results["error"]


def test_get_queue_position_zero():
    # Local simulator → no queue.
    handle = JobHandle(id="x", provider="nvidia", backend="nvidia", status="queued",
                       queue_position=None, shots=1, submitted_at="now")
    assert NvidiaProvider().get_queue_position(handle) == 0
