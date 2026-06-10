"""Unit tests for kernel.server._prepare_hardware_payload (PRD 07 Phase D).

Routing contract:
- Q# → local simulator: raw source passes through (the simulator re-runs it
  through the executor, which already speaks Q#).
- Q# → Azure Quantum: compiled to QIR via QsharpAdapter.compile_qir, with
  the Adaptive_RI profile for Quantinuum targets and Base for the rest.
- Q# → any other provider: friendly RuntimeError (their SDKs are
  Python-circuit-only).
- Python → real hardware: the existing exec + extract path, unchanged.

No qdk, no network: compile_qir is monkeypatched everywhere it would run.
"""

from __future__ import annotations

import os
import tempfile
from unittest import mock

import pytest

# kernel.server builds a module-level HardwareManager at import time, which
# auto-reconnects providers from the OS keyring and loads the persistent job
# store. Guard the import so collecting this test file can never touch the
# developer's real keyring or ~/.nuclei/jobs.json. patch.dict restores the
# environment afterwards so credential-store tests keep their real behavior.
with mock.patch.dict(os.environ, {
    "NUCLEI_DISABLE_CRED_STORE": "1",
    "NUCLEI_DATA_DIR": tempfile.mkdtemp(prefix="nuclei-server-test-"),
}):
    import kernel.server as server

from kernel.adapters.qsharp_adapter import QsharpAdapter
from kernel.server import _prepare_hardware_payload

QSHARP_BELL = """
operation Main() : Result[] {
    use qs = Qubit[2];
    H(qs[0]);
    CNOT(qs[0], qs[1]);
    return [M(qs[0]), M(qs[1])];
}
"""

# Deliberately framework-free Python so the exec path needs no SDK installed;
# the extraction step is monkeypatched in the tests that reach it.
PYTHON_CODE = "marker = 'ran'\n"


# ───────────────────────── Q# allowlist ─────────────────────────


def test_qsharp_to_non_azure_provider_raises_friendly_error():
    with pytest.raises(RuntimeError) as exc_info:
        _prepare_hardware_payload(QSHARP_BELL, "ibm", "ibm_brisbane", "qsharp")
    message = str(exc_info.value)
    assert "Azure Quantum" in message
    assert "ibm" in message


def test_qsharp_regex_detection_applies_allowlist_without_language_hint():
    """Older clients omit `language`; the Q# spec's regex must still gate."""
    with pytest.raises(RuntimeError, match="Azure Quantum"):
        _prepare_hardware_payload(QSHARP_BELL, "ionq", "ionq_aria", None)


# ───────────────────────── Q# → Azure (QIR) ─────────────────────────


def test_qsharp_to_azure_compiles_qir_with_base_profile(monkeypatch):
    qir = object()
    calls: dict[str, object] = {}

    def fake_compile(self, code, target_profile):
        calls["code"] = code
        calls["profile"] = target_profile
        return qir

    monkeypatch.setattr(QsharpAdapter, "compile_qir", fake_compile)
    payload = _prepare_hardware_payload(QSHARP_BELL, "azure", "ionq.simulator", "qsharp")
    assert payload is qir
    assert calls["profile"] == "base"
    assert calls["code"] == QSHARP_BELL


def test_quantinuum_backend_selects_adaptive_ri_profile(monkeypatch):
    calls: dict[str, object] = {}

    def fake_compile(self, code, target_profile):
        calls["profile"] = target_profile
        return object()

    monkeypatch.setattr(QsharpAdapter, "compile_qir", fake_compile)
    _prepare_hardware_payload(QSHARP_BELL, "azure", "quantinuum.sim.h1-1e", "qsharp")
    assert calls["profile"] == "adaptive_ri"


def test_missing_qdk_surfaces_install_hint(monkeypatch):
    def fake_compile(self, code, target_profile):
        raise ImportError("Microsoft QDK (qdk) is not installed in the kernel environment.")

    monkeypatch.setattr(QsharpAdapter, "compile_qir", fake_compile)
    with pytest.raises(RuntimeError, match="setup wizard"):
        _prepare_hardware_payload(QSHARP_BELL, "azure", "ionq.simulator", "qsharp")


# ───────────────────────── simulator passthrough ─────────────────────────


def test_qsharp_to_simulator_passes_raw_source():
    payload = _prepare_hardware_payload(QSHARP_BELL, "simulator", "aer_simulator", "qsharp")
    assert payload is QSHARP_BELL


def test_python_to_simulator_passes_raw_source():
    payload = _prepare_hardware_payload(PYTHON_CODE, "simulator", "aer_simulator", "python")
    assert payload is PYTHON_CODE


# ───────────────────────── Python exec path (unchanged) ─────────────────────────


def test_python_code_to_azure_uses_exec_extract_path(monkeypatch):
    sentinel = object()
    seen: dict[str, object] = {}

    def fake_extract(namespace, provider):
        seen["provider"] = provider
        seen["marker"] = namespace.get("marker")
        return sentinel

    monkeypatch.setattr(server, "_extract_circuit_for_provider", fake_extract)
    payload = _prepare_hardware_payload(PYTHON_CODE, "azure", "ionq.qpu.aria-1", None)
    assert payload is sentinel
    assert seen["provider"] == "azure"
    # Proves the user's code actually executed before extraction.
    assert seen["marker"] == "ran"


def test_python_language_hint_is_not_treated_as_qsharp(monkeypatch):
    def boom(self, code, target_profile):
        raise AssertionError("compile_qir must not be called for python submissions")

    monkeypatch.setattr(QsharpAdapter, "compile_qir", boom)
    sentinel = object()
    monkeypatch.setattr(server, "_extract_circuit_for_provider", lambda ns, p: sentinel)
    payload = _prepare_hardware_payload(PYTHON_CODE, "azure", "ionq.qpu.aria-1", "python")
    assert payload is sentinel


def test_python_code_without_circuit_raises_no_circuit_error(monkeypatch):
    monkeypatch.setattr(server, "_extract_circuit_for_provider", lambda ns, p: None)
    with pytest.raises(RuntimeError, match="No circuit object found"):
        _prepare_hardware_payload(PYTHON_CODE, "ibm", "ibm_brisbane", "python")
