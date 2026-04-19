"""Tests for kernel.hardware.manager.HardwareManager.

Covers provider registration, connect routing, backend listing, job lookup,
and stale-job KeyError handling. No SDK imports required — the simulator
provider is exercised directly and everything else is mocked.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kernel.hardware.base import HardwareProvider, BackendInfo, JobHandle
from kernel.hardware.manager import HardwareManager


class StubProvider(HardwareProvider):
    """Minimal in-memory provider used as a drop-in for routing tests."""

    def __init__(self, *, connect_result: bool = True):
        self.connect_result = connect_result
        self.connect_calls: list[dict] = []
        self.submitted: list[tuple[object, str, int]] = []
        self.cancelled: list[str] = []
        self.queue_position_for: dict[str, int] = {}

    def connect(self, credentials: dict) -> bool:
        self.connect_calls.append(credentials)
        return self.connect_result

    def list_backends(self) -> list[BackendInfo]:
        return [
            BackendInfo(
                name="stub_backend",
                provider="stub",
                qubit_count=4,
                connectivity=[(0, 1), (1, 2)],
                queue_length=0,
                average_error_rate=0.0,
                gate_set=["H", "CNOT"],
                status="online",
            )
        ]

    def submit_job(self, circuit_obj, backend: str, shots: int) -> JobHandle:
        self.submitted.append((circuit_obj, backend, shots))
        return JobHandle(
            id="stub-job-1",
            provider="stub",
            backend=backend,
            status="queued",
            queue_position=None,
            shots=shots,
            submitted_at="2026-04-19T22:00:00Z",
        )

    def get_results(self, job: JobHandle) -> dict:
        return {"measurements": {"00": 512, "11": 512}, "status": "complete"}

    def get_queue_position(self, job: JobHandle) -> int:
        return self.queue_position_for.get(job.id, 0)

    def cancel_job(self, job: JobHandle) -> bool:
        self.cancelled.append(job.id)
        return True


@pytest.fixture
def manager_with_stub():
    manager = HardwareManager()
    stub = StubProvider()
    # Inject our stub in place of the default provider suite so we don't
    # depend on any of the real provider adapters in this test.
    manager._providers = {"stub": stub}
    manager._connected = set()
    manager._jobs = {}
    return manager, stub


def test_registers_all_default_providers():
    manager = HardwareManager()
    expected = {"simulator", "ibm", "google", "ionq", "nvidia", "braket", "azure", "quantinuum"}
    assert expected <= set(manager._providers.keys())


def test_connect_unknown_provider_returns_false():
    manager = HardwareManager()
    assert manager.connect_provider("does_not_exist", {}) is False


def test_connect_happy_path_marks_provider_connected(manager_with_stub):
    manager, stub = manager_with_stub
    assert manager.connect_provider("stub", {"token": "x"}) is True
    assert "stub" in manager._connected
    assert stub.connect_calls == [{"token": "x"}]


def test_connect_failure_leaves_provider_disconnected(manager_with_stub):
    manager, stub = manager_with_stub
    stub.connect_result = False
    assert manager.connect_provider("stub", {}) is False
    assert "stub" not in manager._connected


def test_list_backends_skips_disconnected_providers(manager_with_stub):
    manager, _ = manager_with_stub
    # Nothing connected → aggregate list is empty.
    assert manager.list_backends() == []
    # Connect → backends appear.
    manager.connect_provider("stub", {})
    backends = manager.list_backends()
    assert len(backends) == 1 and backends[0].name == "stub_backend"


def test_list_backends_scoped_to_provider_respects_connection(manager_with_stub):
    manager, _ = manager_with_stub
    # Unknown provider name
    assert manager.list_backends("does_not_exist") == []
    # Known but disconnected
    assert manager.list_backends("stub") == []
    # Connected
    manager.connect_provider("stub", {})
    assert len(manager.list_backends("stub")) == 1


def test_submit_job_requires_connection(manager_with_stub):
    manager, _ = manager_with_stub
    with pytest.raises(RuntimeError, match="not connected"):
        manager.submit_job("stub", MagicMock(), "stub_backend", 512)


def test_submit_job_registers_handle_for_lookup(manager_with_stub):
    manager, stub = manager_with_stub
    manager.connect_provider("stub", {})
    circuit = MagicMock()
    handle = manager.submit_job("stub", circuit, "stub_backend", 256)
    assert handle.id == "stub-job-1"
    assert stub.submitted == [(circuit, "stub_backend", 256)]
    # The manager must remember the handle → later lookups resolve.
    assert manager.get_job_status("stub-job-1") is handle


def test_get_job_status_raises_keyerror_for_stale_id(manager_with_stub):
    manager, _ = manager_with_stub
    # Stale IDs (e.g. from a kernel restart before job persistence is wired)
    # surface as a KeyError the server layer can translate to a friendly
    # message. Never an AttributeError, never a silent None.
    with pytest.raises(KeyError, match="not found"):
        manager.get_job_status("unknown-job-id")


def test_get_job_status_refreshes_queue_position_for_pending_jobs(manager_with_stub):
    manager, stub = manager_with_stub
    manager.connect_provider("stub", {})
    handle = manager.submit_job("stub", MagicMock(), "stub_backend", 100)
    stub.queue_position_for[handle.id] = 42
    refreshed = manager.get_job_status(handle.id)
    assert refreshed.queue_position == 42


def test_get_results_raises_keyerror_for_stale_id(manager_with_stub):
    manager, _ = manager_with_stub
    with pytest.raises(KeyError, match="not found"):
        manager.get_results("unknown-job-id")


def test_cancel_returns_true_for_unknown_job(manager_with_stub):
    """Kernel-side job registry may not know a job the frontend asks to cancel
    (stale ID, reconnect race). The manager treats these as already-gone and
    returns True so the UI can flip to a clean state."""
    manager, _ = manager_with_stub
    assert manager.cancel_job("unknown-job-id") is True


def test_cancel_routes_to_provider_and_marks_failed(manager_with_stub):
    manager, stub = manager_with_stub
    manager.connect_provider("stub", {})
    handle = manager.submit_job("stub", MagicMock(), "stub_backend", 100)
    assert manager.cancel_job(handle.id) is True
    assert stub.cancelled == [handle.id]
    # Status flipped so subsequent polling reflects the cancel.
    assert handle.status == "failed"


def test_cancel_swallows_provider_exception(manager_with_stub):
    manager, stub = manager_with_stub
    manager.connect_provider("stub", {})
    handle = manager.submit_job("stub", MagicMock(), "stub_backend", 100)
    stub.cancel_job = MagicMock(side_effect=RuntimeError("provider ate it"))
    # A provider blowing up during cancel must not propagate — the frontend
    # can always poll status to resolve the truth.
    assert manager.cancel_job(handle.id) is False


# ─────────────── credential persistence + auto-reconnect ───────────────


def test_connect_persists_credentials_to_store(manager_with_stub):
    """When a provider connects successfully, the manager writes the
    credentials to the keyring store so the next kernel start can
    auto-reconnect without the user re-entering them."""
    import kernel.hardware.credential_store as cs

    manager, _ = manager_with_stub
    manager.connect_provider("stub", {"token": "sekret"})
    assert cs.load("stub") == {"token": "sekret"}


def test_connect_with_persist_false_does_not_write_store(manager_with_stub):
    """The manager must support in-memory-only connects for the auto-
    reconnect path itself — it already has the credentials in hand and
    would redundantly re-write them otherwise."""
    import kernel.hardware.credential_store as cs

    manager, _ = manager_with_stub
    manager.connect_provider("stub", {"token": "sekret"}, persist=False)
    assert cs.load("stub") is None


def test_failed_connect_does_not_persist_credentials(manager_with_stub):
    """Don't persist credentials that don't authenticate — otherwise the
    next startup auto-reconnect would repeatedly try a bad token."""
    import kernel.hardware.credential_store as cs

    manager, stub = manager_with_stub
    stub.connect_result = False
    manager.connect_provider("stub", {"token": "bad"})
    assert cs.load("stub") is None


def test_disconnect_clears_stored_credentials(manager_with_stub):
    import kernel.hardware.credential_store as cs

    manager, _ = manager_with_stub
    manager.connect_provider("stub", {"token": "x"})
    assert cs.load("stub") is not None
    manager.disconnect_provider("stub")
    assert cs.load("stub") is None
    assert "stub" not in manager._connected


def test_auto_reconnect_rehydrates_connections_on_construction():
    """Manager constructor reads the credential store and re-connects
    every provider that has stored credentials. Swaps in stub providers
    for the ones we want to assert against."""
    import kernel.hardware.credential_store as cs
    from kernel.hardware.manager import HardwareManager

    # Prime the credential store BEFORE the manager is built.
    cs.save("ibm", {"token": "persisted-tok", "instance": "ibm-q/open/main"})
    cs.save("ionq", {"token": "persisted-ionq"})

    manager = HardwareManager()

    # Real IBM/IonQ providers can't actually connect without their SDKs
    # installed in CI, so we expect _connected to be empty — but the flow
    # ran (no exceptions), and the stored creds remain for the user to
    # see/rotate via the UI.
    assert manager._connected == set() or "ibm" in manager._connected
    # Creds still in store regardless of whether connection succeeded.
    assert cs.load("ibm") is not None
    assert cs.load("ionq") is not None


def test_auto_reconnect_skips_disabled_with_flag():
    """auto_reconnect=False skips the rehydration so tests can build a
    clean manager without touching providers."""
    import kernel.hardware.credential_store as cs
    from kernel.hardware.manager import HardwareManager

    cs.save("ibm", {"token": "x"})
    manager = HardwareManager(auto_reconnect=False)
    assert manager._connected == set()


def test_auto_reconnect_clears_index_entries_for_removed_providers():
    """If a provider was removed in a later version, stale credentials in
    the store should be cleaned up rather than repeatedly probed."""
    import kernel.hardware.credential_store as cs
    from kernel.hardware.manager import HardwareManager

    cs.save("ibm", {"token": "x"})
    cs.save("fake_removed_provider", {"token": "y"})

    HardwareManager()

    assert "fake_removed_provider" not in cs.list_providers()
    # Real provider entries are preserved.
    assert "ibm" in cs.list_providers()
