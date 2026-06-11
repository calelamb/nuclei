"""QuantinuumProvider tests — fully mocked, no pytket required.

Covers the circuit-conversion fix (PRD item 2): Qiskit and Cirq circuits
submitted to Quantinuum must be converted via pytket extensions, or the
provider should return a clear 'install pytket-extensions-qiskit' error
rather than the opaque pytket type error the SDK throws.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from kernel.hardware.base import JobHandle
from kernel.hardware.quantinuum_provider import QuantinuumProvider
from kernel.tests.hardware.conftest import assert_handle_failed


# ───────────────────────── connect() ─────────────────────────


def _install_quantinuum_auth_sdk(install_fake_sdk):
    """Install the full fake pytket-quantinuum auth surface.

    connect() validates the token by seeding a MemoryCredentialStorage,
    wrapping it in a QuantinuumAPI handler, and listing devices through
    that handler — so the fakes model all three names.
    """
    FakeBackend = MagicMock()
    FakeBackend.available_devices.return_value = [{"name": "H1-1LE"}]
    fake_api = MagicMock(name="api_handler")
    FakeAPI = MagicMock(return_value=fake_api)
    fake_store = MagicMock(name="cred_store")
    FakeStorage = MagicMock(return_value=fake_store)
    install_fake_sdk(
        "pytket.extensions.quantinuum",
        QuantinuumBackend=FakeBackend,
        QuantinuumAPI=FakeAPI,
    )
    install_fake_sdk(
        "pytket.extensions.quantinuum.backends.credential_storage",
        MemoryCredentialStorage=FakeStorage,
    )
    return FakeBackend, FakeAPI, fake_api, FakeStorage, fake_store


def test_connect_missing_dependency_returns_false(block_sdk_import, capsys):
    block_sdk_import("pytket")
    assert QuantinuumProvider().connect({"token": "x"}) is False
    assert "pytket-quantinuum" in capsys.readouterr().out


def test_connect_modern_sdk_without_token_auth_explains_version(install_fake_sdk, capsys):
    """pytket-quantinuum >= ~0.26 dropped the credential-storage seam this
    provider authenticates through (`MemoryCredentialStorage` and the
    `QuantinuumAPI(token_store=...)` kwarg are gone; `QuantinuumAPI` is an
    offline alias whose available_devices needs no auth). connect() must
    refuse with a version-support message — NOT the misleading
    "requires pytket-quantinuum" install hint (the package IS installed),
    and NOT a fake validated connection."""
    # Modern SDK shape: the package and QuantinuumAPI name exist, but the
    # credential_storage module (and MemoryCredentialStorage) do not.
    FakeBackend = MagicMock()
    install_fake_sdk(
        "pytket.extensions.quantinuum",
        QuantinuumBackend=FakeBackend,
        QuantinuumAPI=MagicMock(name="offline_api_alias"),
    )

    provider = QuantinuumProvider()
    assert provider.connect({"token": "tok"}) is False

    out = capsys.readouterr().out
    # The honest message: version support, the pin, and the Azure path.
    assert "does not support direct API-token authentication" in out
    assert "pytket-quantinuum<0.26" in out
    assert "Azure" in out
    # NOT the missing-package install hint — the package is installed.
    assert "Install with: pip install pytket-quantinuum" not in out

    # No fake validation happened and no connected state leaked.
    FakeBackend.available_devices.assert_not_called()
    assert provider._backend_cls is None
    assert provider._api_handler is None
    assert provider._token is None
    assert provider.list_backends() == []


def test_connect_requires_token(install_fake_sdk, capsys):
    _install_quantinuum_auth_sdk(install_fake_sdk)
    assert QuantinuumProvider().connect({}) is False
    assert "token" in capsys.readouterr().out.lower()


def test_connect_happy_path(install_fake_sdk):
    FakeBackend, _FakeAPI, fake_api, _FakeStorage, _store = (
        _install_quantinuum_auth_sdk(install_fake_sdk)
    )

    provider = QuantinuumProvider()
    assert provider.connect({"token": "tok"}) is True
    assert provider._backend_cls is FakeBackend
    assert provider._token == "tok"
    # The validated handler is kept so later submits authenticate the
    # same way the validation did.
    assert provider._api_handler is fake_api


def test_connect_validates_token_via_authenticated_device_list(install_fake_sdk):
    """The latent bug: connect() returned True for ANY non-empty string
    without talking to Quantinuum — auth failures surfaced only at submit
    time. connect() must now route the token into the SDK's credential
    store and make one cheap authenticated call (device listing)."""
    FakeBackend, FakeAPI, fake_api, _FakeStorage, fake_store = (
        _install_quantinuum_auth_sdk(install_fake_sdk)
    )

    assert QuantinuumProvider().connect({"token": "tok"}) is True

    # The token reached the SDK's credential store. The Nexus token is an
    # *id* token — the refresh slot must stay empty, otherwise the SDK's
    # mid-session renewal silently fails with a nonsense refresh token.
    fake_store.save_tokens.assert_called_once_with(
        id_token="tok", refresh_token=""
    )
    # ...the API handler was built from that store...
    FakeAPI.assert_called_once_with(token_store=fake_store)
    # ...and the validation call went through the authenticated handler.
    FakeBackend.available_devices.assert_called_once_with(api_handler=fake_api)


def test_connect_rejected_token_returns_false_with_hint(install_fake_sdk, capsys):
    """A bad token must fail fast at connect() — not at submit time —
    with the SDK error plus a hint about pytket-quantinuum's login flow."""
    FakeBackend, _FakeAPI, _api, _FakeStorage, _store = (
        _install_quantinuum_auth_sdk(install_fake_sdk)
    )
    FakeBackend.available_devices.side_effect = PermissionError(
        "401 Unauthorized: invalid token"
    )

    provider = QuantinuumProvider()
    assert provider.connect({"token": "bad-token"}) is False

    out = capsys.readouterr().out
    assert "Quantinuum connection failed" in out
    assert "401 Unauthorized" in out
    assert "pytket-quantinuum" in out  # names the SDK's own login flow

    # No partial connected state leaks out of a failed validation.
    assert provider._backend_cls is None
    assert provider._token is None
    assert provider._api_handler is None
    assert provider.list_backends() == []


def test_submit_uses_connected_api_handler(install_fake_sdk):
    """The handler validated at connect() must be the one used at submit,
    otherwise the token we validated isn't the credential that submits."""
    FakeBackend, _FakeAPI, fake_api, _FakeStorage, _store = (
        _install_quantinuum_auth_sdk(install_fake_sdk)
    )
    qb = MagicMock()
    qb.get_compiled_circuit.return_value = "compiled"
    qb.process_circuit.return_value = "handle-obj"
    FakeBackend.return_value = qb

    provider = QuantinuumProvider()
    assert provider.connect({"token": "tok"}) is True

    handle = provider.submit_job(MagicMock(), "H1-1LE", 100)
    assert handle.status == "queued"
    FakeBackend.assert_called_once_with(device_name="H1-1LE", api_handler=fake_api)


# ───────────────────────── list_backends() ─────────────────────────


def test_list_backends_hardcoded_catalog():
    provider = QuantinuumProvider()
    provider._backend_cls = MagicMock()  # pretend connected
    backends = provider.list_backends()
    names = {b.name for b in backends}
    assert names == {"H1-1", "H2-1", "H1-1E", "H1-1LE"}


# ───────────────────────── submit_job() — circuit conversion ─────────────────────────


def test_submit_without_connection_raises():
    with pytest.raises(RuntimeError, match="not connected"):
        QuantinuumProvider().submit_job(MagicMock(), "H1-1LE", 100)


def _pytket_only_provider(install_fake_sdk):
    """Build a connected Quantinuum provider with pytket-quantinuum only —
    no qiskit/cirq extensions installed."""
    qb = MagicMock()
    qb.get_compiled_circuit.return_value = "compiled"
    qb.process_circuit.return_value = "handle-obj"
    FakeBackend = MagicMock(return_value=qb)
    install_fake_sdk("pytket.extensions.quantinuum", QuantinuumBackend=FakeBackend)
    provider = QuantinuumProvider()
    provider._backend_cls = FakeBackend
    return provider, qb


class FakeQiskitCircuit:
    """Duck-typed so provider's isinstance checks succeed without a real
    qiskit install — the provider imports qiskit.QuantumCircuit lazily and
    compares against it."""
    pass


class FakeCirqCircuit:
    pass


def test_submit_native_pytket_circuit_happy_path(install_fake_sdk):
    """Circuit is already a pytket.Circuit — no conversion needed."""
    provider, qb = _pytket_only_provider(install_fake_sdk)
    pytket_circuit = MagicMock()  # already a pytket Circuit
    handle = provider.submit_job(pytket_circuit, "H1-1LE", 100)
    assert handle.status == "queued"
    assert handle.error is None
    qb.get_compiled_circuit.assert_called_once_with(pytket_circuit)


def test_submit_qiskit_circuit_converts_via_extension(install_fake_sdk):
    """When a user has Qiskit code in the editor and submits to Quantinuum,
    the provider should detect QuantumCircuit, convert via
    pytket.extensions.qiskit.qiskit_to_tk, and then submit."""
    provider, qb = _pytket_only_provider(install_fake_sdk)

    # Install qiskit with a QuantumCircuit class, and pytket.extensions.qiskit
    # with a qiskit_to_tk converter.
    install_fake_sdk("qiskit", QuantumCircuit=FakeQiskitCircuit)
    fake_qiskit_to_tk = MagicMock(return_value="tk-circuit")
    install_fake_sdk("pytket.extensions.qiskit", qiskit_to_tk=fake_qiskit_to_tk)

    qc = FakeQiskitCircuit()
    handle = provider.submit_job(qc, "H1-1LE", 100)

    # Conversion happened
    fake_qiskit_to_tk.assert_called_once_with(qc)
    # Then pytket got the converted circuit.
    qb.get_compiled_circuit.assert_called_once_with("tk-circuit")
    assert handle.status == "queued"
    assert handle.error is None


def test_submit_cirq_circuit_converts_via_extension(install_fake_sdk):
    provider, qb = _pytket_only_provider(install_fake_sdk)
    install_fake_sdk("cirq", Circuit=FakeCirqCircuit)
    fake_cirq_to_tk = MagicMock(return_value="tk-cirq-circuit")
    install_fake_sdk("pytket.extensions.cirq", cirq_to_tk=fake_cirq_to_tk)

    cc = FakeCirqCircuit()
    handle = provider.submit_job(cc, "H1-1LE", 100)
    fake_cirq_to_tk.assert_called_once_with(cc)
    qb.get_compiled_circuit.assert_called_once_with("tk-cirq-circuit")
    assert handle.status == "queued"


def test_submit_qiskit_circuit_without_extension_returns_install_hint(install_fake_sdk):
    """PRD item 2: if pytket-extensions-qiskit isn't installed, return a
    JobHandle with a readable error telling the user what to install —
    not the raw pytket type error."""
    provider, _qb = _pytket_only_provider(install_fake_sdk)
    install_fake_sdk("qiskit", QuantumCircuit=FakeQiskitCircuit)
    # Do NOT install pytket.extensions.qiskit — simulate missing extension.

    qc = FakeQiskitCircuit()
    handle = provider.submit_job(qc, "H1-1LE", 100)
    assert_handle_failed(
        handle,
        expected_error_contains=["pytket-extensions-qiskit"],
    )


def test_submit_cirq_circuit_without_extension_returns_install_hint(install_fake_sdk):
    provider, _qb = _pytket_only_provider(install_fake_sdk)
    install_fake_sdk("cirq", Circuit=FakeCirqCircuit)

    cc = FakeCirqCircuit()
    handle = provider.submit_job(cc, "H1-1LE", 100)
    assert_handle_failed(
        handle,
        expected_error_contains=["pytket-extensions-cirq"],
    )


def test_submit_sdk_error_populates_handle_error(install_fake_sdk, sample_circuit):
    provider, qb = _pytket_only_provider(install_fake_sdk)
    qb.process_circuit.side_effect = RuntimeError("Nexus quota exceeded")

    handle = provider.submit_job(sample_circuit, "H1-1LE", 1)
    assert_handle_failed(handle, expected_error_contains=["quota"])


# ───────────────────────── get_results() ─────────────────────────


def test_get_results_completed_returns_counts(install_fake_sdk):
    qb = MagicMock()
    status_obj = MagicMock()
    status_obj.status.name = "COMPLETED"
    qb.circuit_status.return_value = status_obj
    counts_map = {(0, 0): 400, (1, 1): 600}
    result_obj = MagicMock()
    result_obj.get_counts.return_value = counts_map
    qb.get_result.return_value = result_obj
    FakeBackend = MagicMock(return_value=qb)
    install_fake_sdk("pytket.extensions.quantinuum", QuantinuumBackend=FakeBackend)

    provider = QuantinuumProvider()
    provider._backend_cls = FakeBackend
    provider._jobs["j"] = ("H1-1LE", "sdk-handle")

    handle = JobHandle(id="j", provider="quantinuum", backend="H1-1LE",
                       status="queued", queue_position=None, shots=1000,
                       submitted_at="now")
    results = provider.get_results(handle)
    assert results["status"] == "complete"
    # Tuples flattened to bitstrings.
    assert results["measurements"] == {"00": 400, "11": 600}


def test_get_results_error_status(install_fake_sdk):
    qb = MagicMock()
    status_obj = MagicMock()
    status_obj.status.name = "ERROR"
    qb.circuit_status.return_value = status_obj
    FakeBackend = MagicMock(return_value=qb)
    install_fake_sdk("pytket.extensions.quantinuum", QuantinuumBackend=FakeBackend)

    provider = QuantinuumProvider()
    provider._backend_cls = FakeBackend
    provider._jobs["j"] = ("H1-1LE", "sdk")

    handle = JobHandle(id="j", provider="quantinuum", backend="H1-1LE",
                       status="queued", queue_position=None, shots=1,
                       submitted_at="now")
    assert provider.get_results(handle)["status"] == "failed"


# ───────────────────────── cancel ─────────────────────────


def test_cancel_routes_to_sdk(install_fake_sdk):
    qb = MagicMock()
    FakeBackend = MagicMock(return_value=qb)
    install_fake_sdk("pytket.extensions.quantinuum", QuantinuumBackend=FakeBackend)

    provider = QuantinuumProvider()
    provider._backend_cls = FakeBackend
    provider._jobs["c"] = ("H1-1LE", "sdk-handle")

    handle = JobHandle(id="c", provider="quantinuum", backend="H1-1LE",
                       status="queued", queue_position=None, shots=1,
                       submitted_at="now")
    assert provider.cancel_job(handle) is True
    qb.cancel.assert_called_once_with("sdk-handle")
