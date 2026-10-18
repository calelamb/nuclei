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
        wall_seconds=120,
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
        wall_seconds=120,
        isolation=info,
    )
    assert response["isolation"] == "sandbox-exec"
    assert response["stdout"].strip() == "write-denied"


_PROBE_SCRIPT = r"""
import json, os, socket, sys
scratch, outside = sys.argv[1], sys.argv[2]
def attempt(fn):
    try:
        fn(); return "ok"
    except OSError:
        return "denied"
def write(path):
    with open(path, "w") as fh:
        fh.write("x")
print(json.dumps({
    "inside": attempt(lambda: write(os.path.join(scratch, "inside.txt"))),
    "outside": attempt(lambda: write(outside)),
    "tmp_env": os.environ.get("TMPDIR") == scratch and os.environ.get("MPLCONFIGDIR") == scratch,
    "socket": attempt(lambda: socket.create_connection(("127.0.0.1", 9), timeout=2)),
    "bind": attempt(lambda: socket.socket().bind(("127.0.0.1", 0))),
}))
"""


@pytest.mark.skipif(sys.platform != "darwin", reason="sandbox-exec is macOS only")
def test_macos_profile_confines_writes_to_private_scratch_and_blocks_sockets(tmp_path):
    import json
    import os
    import subprocess

    from kernel.discovery.procrun import minimal_env

    if iso.detect_isolation().mode != "sandbox-exec":
        pytest.skip("sandbox-exec not usable here")
    outside = str(tmp_path / "outside.txt")
    with iso.private_scratch_dir() as scratch:
        assert os.stat(scratch).st_mode & 0o777 == 0o700
        assert scratch == os.path.realpath(scratch)
        cmd = iso._sandbox_exec_wrap([sys.executable, "-c", _PROBE_SCRIPT, scratch, outside], scratch)
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60,
                             env=minimal_env(iso.scratch_env(scratch)))
        report = json.loads(out.stdout.strip().splitlines()[-1])
    assert report == {"inside": "ok", "outside": "denied", "tmp_env": True,
                      "socket": "denied", "bind": "denied"}, (report, out.stderr)
    assert not os.path.exists(outside)
    assert not os.path.exists(scratch), "scratch directory must be deleted after the run"


@pytest.mark.skipif(sys.platform != "darwin", reason="sandbox-exec is macOS only")
def test_run_candidate_removes_its_scratch_directory(tmp_path, monkeypatch):
    import tempfile

    created: list[str] = []
    real = tempfile.mkdtemp

    def spy(*args, **kwargs):
        path = real(*args, **kwargs)
        created.append(path)
        return path

    monkeypatch.setattr(tempfile, "mkdtemp", spy)
    response = run_candidate(
        default_request("stim_circuit", GOOD, "build", [{"args": [3, 3], "kwargs": {}}]),
        wall_seconds=60,
    )
    assert response["status"] == "ok"
    import os
    assert created and not any(os.path.exists(p) for p in created)
