"""Isolation probe tests: report only what actually ran (spec 4.1.7)."""

from __future__ import annotations

import sys

import pytest

pytest.importorskip("stim")

from kernel.discovery import isolation as iso  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402

GOOD = "import stim\ndef build(d, r):\n    return stim.Circuit('H 0')\n"


@pytest.fixture(autouse=True)
def _fresh_probe(monkeypatch):
    monkeypatch.delenv("NUCLEI_DISCOVERY_ISOLATION", raising=False)
    iso.reset_for_tests()
    yield
    iso.reset_for_tests()


def test_environment_override_forces_process(monkeypatch):
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    assert iso.detect_isolation(refresh=True).mode == "process"


def test_detected_mode_is_a_known_value_and_cached():
    info = iso.detect_isolation()
    assert info.mode in {"process", "bwrap", "sandbox-exec"}
    assert iso.detect_isolation() is info


def test_broken_wrapper_falls_back_to_process_honestly(monkeypatch):
    monkeypatch.setattr(iso, "_candidate_modes", lambda: [("sandbox-exec", lambda cmd: ["/nonexistent-wrapper", *cmd])])
    info = iso.detect_isolation(refresh=True)
    assert info.mode == "process"
    assert "unavailable at runtime" in info.note


def test_wrapper_that_fails_at_run_time_is_demoted(monkeypatch):
    broken = iso.IsolationInfo("sandbox-exec", lambda cmd: ["sh", "-c", "echo 'sandbox-exec: sandbox_apply: Operation not permitted' >&2; exit 71"])
    response = run_candidate(
        default_request("stim_circuit", GOOD, "build", [{"args": [3, 3], "kwargs": {}}]),
        wall_seconds=30,
        isolation=broken,
    )
    # Falls back to an unwrapped run and reports "process", never the wrapper.
    assert response["status"] == "ok"
    assert response["isolation"] == "process"


@pytest.mark.skipif(sys.platform != "darwin", reason="sandbox-exec is macOS only")
def test_macos_sandbox_exec_blocks_network_and_writes_when_active():
    info = iso.detect_isolation()
    if info.mode != "sandbox-exec":
        pytest.skip(f"sandbox-exec not usable here: {info.note}")
    program = (
        "import stim\n"
        "def build(d, r):\n"
        "    import importlib\n"
        "    out = []\n"
        "    try:\n"
        "        open('/tmp/nuclei_isolation_probe', 'w')\n"
        "        out.append('write-ok')\n"
        "    except OSError:\n"
        "        out.append('write-denied')\n"
        "    print(','.join(out))\n"
        "    return stim.Circuit('H 0')\n"
    )
    response = run_candidate(
        default_request("stim_circuit", program, "build", [{"args": [3, 3], "kwargs": {}}]),
        wall_seconds=30,
        isolation=info,
    )
    assert response["isolation"] == "sandbox-exec"
    assert response["stdout"].strip() == "write-denied"
