"""Isolation probe tests: report only what actually ran (spec 4.1.7)."""

from __future__ import annotations

import os
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


# --- RT-H2: file reads under sandbox-exec ---------------------------------------------------

READ_PROBE = (
    "import stim\n"
    "def build():\n"
    "    try:\n"
    "        data = open({path!r}).read()\n"
    "        print('READ:' + data)\n"
    "    except OSError as exc:\n"
    "        print('DENIED:' + type(exc).__name__)\n"
    "    return stim.Circuit('H 0')\n"
)


def _mac_info():
    info = iso.detect_isolation()
    if sys.platform != "darwin" or info.mode != "sandbox-exec":
        pytest.skip(f"sandbox-exec not usable here: {info.note}")
    return info


def test_macos_sandbox_denies_reading_files_outside_the_allow_list(tmp_path):
    # Regression for poc_read_exfil.py: a dummy secret OUTSIDE the allow-list must be unreadable.
    info = _mac_info()
    secret = tmp_path / "dummy_secret.txt"
    secret.write_text("SK-DUMMY-TOKEN-abc123-not-a-real-secret")
    response = run_candidate(
        default_request("stim_circuit", READ_PROBE.format(path=str(secret)), "build", [{"args": [], "kwargs": {}}]),
        wall_seconds=120,
        isolation=info,
    )
    assert response["status"] == "ok", response
    assert response["isolation"] == "sandbox-exec"
    assert "SK-DUMMY-TOKEN" not in response["stdout"]
    assert response["stdout"].startswith("DENIED:")


def test_macos_sandbox_denies_listing_and_home_dotfiles(tmp_path):
    info = _mac_info()
    (tmp_path / "x.txt").write_text("hello")
    program = (
        "import os, stim\n"
        "def build():\n"
        f"    try:\n        print(os.listdir({str(tmp_path)!r}))\n"
        "    except OSError as exc:\n        print('LIST-DENIED')\n"
        "    for p in ('/etc/passwd', os.path.expanduser('~/.ssh/id_rsa'), '/private/etc/hosts'):\n"
        "        try:\n            open(p).read(1); print('READ-OK', p)\n"
        "        except OSError:\n            pass\n"
        "    return stim.Circuit('H 0')\n"
    )
    response = run_candidate(
        default_request("stim_circuit", program, "build", [{"args": [], "kwargs": {}}]),
        wall_seconds=120, isolation=info,
    )
    assert response["status"] == "ok", response
    assert "LIST-DENIED" in response["stdout"] and "READ-OK" not in response["stdout"]


def test_macos_sandbox_still_runs_numpy_stim_qiskit_and_cirq_candidates():
    info = _mac_info()
    cases = [
        ("stim_circuit", "import numpy as np, stim\ndef build():\n    np.linalg.eigh(np.eye(4))\n    return stim.Circuit('H 0')\n"),
        ("quantum_circuit", "from qiskit import QuantumCircuit, transpile\ndef build():\n    qc = QuantumCircuit(3)\n    qc.h(0); qc.cx(0, 1); qc.cx(1, 2)\n    return transpile(qc, basis_gates=['rz', 'sx', 'cx'], optimization_level=1)\n"),
        ("quantum_circuit", "import cirq\ndef build():\n    q = cirq.LineQubit.range(2)\n    return cirq.Circuit(cirq.H(q[0]), cirq.CNOT(q[0], q[1]))\n"),
    ]
    for task, program in cases:
        if task == "quantum_circuit":
            pytest.importorskip("qiskit")
            pytest.importorskip("cirq")
        response = run_candidate(
            default_request(task, program, "build", [{"args": [], "kwargs": {}}]), wall_seconds=120, isolation=info,
        )
        assert response["status"] == "ok", (task, response["error"])
        assert response["isolation"] == "sandbox-exec"


def test_profile_text_denies_reads_by_default_and_lists_only_needed_roots():
    profile, params = iso.mac_profile("/private/var/folders/x/scratch", ["/opt/py", "/repo/kernel"])
    assert "(deny file-read*)" in profile
    assert "(allow default)" in profile and "(deny network*)" in profile
    assert profile.index("(deny file-read*)") < profile.index('(param "READ0")')
    assert "SCRATCH=/private/var/folders/x/scratch" in params
    assert "READ0=/opt/py" in params and "READ1=/repo/kernel" in params
    # No blanket reads.
    assert '(allow file-read* (subpath "/"))' not in profile
    assert '(subpath "/Users")' not in profile and '(subpath "/private/var/folders")' not in profile


def test_python_read_roots_cover_the_interpreter_and_kernel_but_not_home():
    roots = iso.python_read_roots()
    assert any(os.path.realpath(sys.prefix) == r for r in roots)
    assert any(r.endswith(os.sep + "kernel") for r in roots)
    assert os.path.realpath(os.path.expanduser("~")) not in roots


def test_bwrap_argv_binds_only_what_is_needed_read_only():
    argv = iso._bwrap_wrap(["python", "-I", "w.py"], "/tmp/nuclei-cand-abc", ["/venv", "/repo/kernel"])
    assert argv[:4] == ["bwrap", "--unshare-net", "--unshare-pid", "--die-with-parent"]
    binds = [argv[i + 1] for i, a in enumerate(argv) if a == "--ro-bind"]
    assert binds == ["/venv", "/repo/kernel"]
    # The old blanket bind of the host root is gone.
    assert "/" not in [argv[i + 1] for i, a in enumerate(argv) if a in ("--ro-bind", "--ro-bind-try", "--bind")]
    assert all(argv[i + 1] == argv[i + 2] for i, a in enumerate(argv) if a in ("--ro-bind", "--ro-bind-try"))
    for private in ("/home", "/root", "/etc/passwd", "/var"):
        assert private not in argv
    assert argv[-3:] == ["python", "-I", "w.py"]
    assert "--tmpfs" in argv and "--dev" in argv
    # The scratch dir is the only writable bind, and comes after the private /tmp.
    i = argv.index("--bind")
    assert argv[i + 1 : i + 3] == ["/tmp/nuclei-cand-abc", "/tmp/nuclei-cand-abc"]
    assert i > argv.index("--tmpfs")
    assert [a for a in argv if a == "--bind"] == ["--bind"]
    assert iso.IsolationInfo(iso.MODE_BWRAP, iso._bwrap_wrap, scratch_aware=True).command(["x"], "/tmp/s")[-1] == "x"


def test_isolation_detail_is_honest_about_reads():
    response = run_candidate(
        default_request("stim_circuit", GOOD, "build", [{"args": [], "kwargs": {}}]),
        wall_seconds=120,
        isolation=iso.IsolationInfo(iso.MODE_PROCESS),
    )
    assert response["isolation"] == "process"
    assert response["isolation_detail"] == {"reads": "unrestricted"}
    failure = run_candidate(
        default_request("stim_circuit", "x = (", "build", [{"args": [], "kwargs": {}}]),
        wall_seconds=120,
        isolation=iso.IsolationInfo(iso.MODE_PROCESS),
    )
    assert failure["isolation_detail"] == {"reads": "unrestricted"}


def test_isolation_detail_reports_restricted_reads_only_when_a_wrapper_ran():
    info = _mac_info()
    response = run_candidate(
        default_request("stim_circuit", GOOD, "build", [{"args": [], "kwargs": {}}]), wall_seconds=120, isolation=info,
    )
    assert response["isolation"] == "sandbox-exec"
    assert response["isolation_detail"] == {"reads": "restricted"}
    assert info.detail == {"reads": "restricted"}
