"""Isolation probe tests: report only what actually ran (spec 4.1.7)."""

from __future__ import annotations

import os
import sys

import pytest

pytest.importorskip("stim")

from kernel.discovery import isolation as iso  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402

GOOD = "import stim\ndef build(d, r):\n    return stim.Circuit('H 0')\n"
PROCESS_DETAIL = {"reads": "unrestricted", "writes": "unrestricted", "network": "unrestricted"}
CONFINED_DETAIL = {"reads": "restricted", "writes": "scratch-only", "network": "denied"}


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
    assert info.mode in {"process", "bwrap", "sandbox-exec", "landlock"}
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
    assert response["isolation_detail"] == PROCESS_DETAIL
    failure = run_candidate(
        default_request("stim_circuit", "x = (", "build", [{"args": [], "kwargs": {}}]),
        wall_seconds=120,
        isolation=iso.IsolationInfo(iso.MODE_PROCESS),
    )
    assert failure["isolation_detail"] == PROCESS_DETAIL


def test_isolation_detail_reports_restricted_reads_only_when_a_wrapper_ran():
    info = _mac_info()
    response = run_candidate(
        default_request("stim_circuit", GOOD, "build", [{"args": [], "kwargs": {}}]), wall_seconds=120, isolation=info,
    )
    assert response["isolation"] == "sandbox-exec"
    assert response["isolation_detail"] == CONFINED_DETAIL
    assert info.detail == CONFINED_DETAIL


# --- PRD 15 R-F / R-19: landlock tier, bwrap userns probe, consent, graceful group kill ------------

import json  # noqa: E402
import subprocess  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402

from kernel.discovery import landlock  # noqa: E402
from kernel.discovery.procrun import minimal_env  # noqa: E402
from kernel.discovery.sandbox import ERR_PRESCREEN, kill_process_group  # noqa: E402

needs_landlock = pytest.mark.skipif(landlock.abi_version() < 1, reason="Landlock unavailable on this kernel")
CALL = [{"args": [], "kwargs": {}}]


def _tier(name: str) -> iso.IsolationInfo:
    """The verified isolation for tier ``name``, or skip when this host cannot provide it."""
    if name == "process":
        return iso.IsolationInfo(iso.MODE_PROCESS)
    wrap = {"landlock": iso._landlock_wrap, "bwrap": iso._bwrap_wrap, "sandbox-exec": iso._sandbox_exec_wrap}[name]
    if name == "landlock" and landlock.abi_version() < 1:
        pytest.skip("Landlock unavailable")
    if name == "bwrap" and not (sys.platform.startswith("linux") and __import__("shutil").which("bwrap") and iso.userns_probe()[0]):
        pytest.skip("bwrap unusable (no binary or user namespaces blocked)")
    if name == "sandbox-exec" and sys.platform != "darwin":
        pytest.skip("sandbox-exec is macOS only")
    ok, why = iso.probe_wrapper(wrap)
    if not ok:
        pytest.skip(f"{name} did not pass its probe here: {why}")
    return iso.IsolationInfo(name, wrap, scratch_aware=True, reads=iso.READS_RESTRICTED)


def test_landlock_abi_probe_reports_a_version_on_modern_linux():
    if not sys.platform.startswith("linux"):
        assert landlock.abi_version() == 0
        return
    assert landlock.abi_version() >= 0
    assert landlock.denies_tcp(4) and not landlock.denies_tcp(3)


@needs_landlock
def test_landlock_tier_is_chosen_when_bwrap_is_blocked_and_reports_observed_detail(monkeypatch):
    monkeypatch.setattr(iso, "userns_probe", lambda: (False, "bwrap: setting up uid map: Permission denied"))
    info = iso.detect_isolation(refresh=True)
    assert info.mode == "landlock", info.note
    assert info.scratch_aware and not info.needs_consent
    assert info.reads == "restricted" and info.writes == "scratch-only"
    assert info.network == ("denied" if landlock.denies_tcp(landlock.abi_version()) else "unrestricted")
    assert f"ABI {landlock.abi_version()}" in info.note


def test_bwrap_is_preferred_over_landlock_when_user_namespaces_work(monkeypatch):
    if not sys.platform.startswith("linux"):
        pytest.skip("Linux tiers")
    monkeypatch.setattr(iso.shutil, "which", lambda name: "/usr/bin/bwrap")
    monkeypatch.setattr(iso, "userns_probe", lambda: (True, "user namespaces available"))
    monkeypatch.setattr(landlock, "abi_version", lambda: 8)
    assert [mode for mode, _ in iso._candidate_modes()] == ["bwrap", "landlock"]


def test_process_note_explains_why_stronger_tiers_were_skipped(monkeypatch):
    if not sys.platform.startswith("linux"):
        pytest.skip("Linux tiers")
    monkeypatch.setattr(iso.shutil, "which", lambda name: "/usr/bin/bwrap")
    monkeypatch.setattr(iso, "userns_probe", lambda: (False, "bwrap: setting up uid map: Permission denied"))
    monkeypatch.setattr(landlock, "abi_version", lambda: 0)
    info = iso.detect_isolation(refresh=True)
    assert info.mode == "process" and info.needs_consent
    assert "uid map" in info.note and "landlock unavailable" in info.note


def test_userns_probe_names_the_apparmor_restriction(monkeypatch, tmp_path):
    sysctl = tmp_path / "apparmor_restrict_unprivileged_userns"
    sysctl.write_text("1\n")
    monkeypatch.setattr(iso, "USERNS_SYSCTL", str(sysctl))
    failed = subprocess.CompletedProcess([], 1, b"", b"bwrap: setting up uid map: Permission denied\n")
    monkeypatch.setattr(iso.subprocess, "run", lambda *a, **k: failed)
    usable, reason = iso.userns_probe()
    assert not usable
    assert "uid map" in reason and "apparmor_restrict_unprivileged_userns=1" in reason
    monkeypatch.setattr(iso.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess([], 0, b"", b""))
    assert iso.userns_probe() == (True, "user namespaces available")


def test_userns_probe_survives_a_missing_binary(monkeypatch):
    def boom(*args, **kwargs):
        raise FileNotFoundError("bwrap")

    monkeypatch.setattr(iso.subprocess, "run", boom)
    usable, reason = iso.userns_probe()
    assert not usable and "could not be started" in reason


def test_confinement_observation_reports_unrestricted_for_a_plain_process():
    assert iso.observe_confinement(lambda cmd: cmd) == PROCESS_DETAIL


@needs_landlock
def test_confinement_observation_reports_what_landlock_actually_denies():
    observed = iso.observe_confinement(iso._landlock_wrap)
    assert observed["reads"] == "restricted" and observed["writes"] == "scratch-only"
    assert observed["network"] == ("denied" if landlock.denies_tcp(landlock.abi_version()) else "unrestricted")


def test_process_tier_needs_consent_unless_the_operator_forced_it(monkeypatch):
    assert iso.IsolationInfo(iso.MODE_PROCESS).needs_consent
    assert not iso.IsolationInfo(iso.MODE_LANDLOCK).needs_consent
    assert not iso.IsolationInfo(iso.MODE_BWRAP).needs_consent
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    forced = iso.detect_isolation(refresh=True)
    assert forced.mode == "process" and not forced.needs_consent


def test_capability_text_states_what_unsandboxed_candidates_can_do():
    text = iso.PROCESS_CAPABILITY_TEXT
    for phrase in ("cannot sandbox candidate code", "your own user account", "read, modify and delete any file", "network"):
        assert phrase in text


# --- landlock enforcement, probed through the real launcher -----------------------------------

_ENFORCEMENT_SCRIPT = r"""
import json, os, socket, sys
canary, scratch, project = sys.argv[1], sys.argv[2], sys.argv[3]
def attempt(fn):
    try:
        fn(); return "ok"
    except PermissionError:
        return "denied"
    except OSError as exc:
        return type(exc).__name__
def write(path):
    with open(path, "w") as handle:
        handle.write("x")
def read(path):
    with open(path) as handle:
        handle.read()
print(json.dumps({
    "read_outside": attempt(lambda: read(os.path.join(canary, "secret.txt"))),
    "list_outside": attempt(lambda: os.listdir(canary)),
    "write_outside": attempt(lambda: write(os.path.join(canary, "new.txt"))),
    "delete_outside": attempt(lambda: os.remove(os.path.join(canary, "secret.txt"))),
    "write_scratch": attempt(lambda: write(os.path.join(scratch, "ok.txt"))),
    "delete_scratch": attempt(lambda: os.remove(os.path.join(scratch, "ok.txt"))),
    "read_project": attempt(lambda: read(os.path.join(project, "data.txt"))) if project else "n/a",
    "write_project": attempt(lambda: write(os.path.join(project, "new.txt"))) if project else "n/a",
    "connect": attempt(lambda: socket.create_connection(("127.0.0.1", 1), timeout=2).close()),
    "bind": attempt(lambda: socket.socket().bind(("127.0.0.1", 0))),
}))
"""


def _enforce(tmp_path, project_root=None):
    canary = tmp_path / "canary"
    canary.mkdir()
    (canary / "secret.txt").write_text("SECRET")
    with iso.private_scratch_dir() as scratch:
        info = _tier("landlock")
        argv = [sys.executable, "-I", "-c", _ENFORCEMENT_SCRIPT, str(canary), scratch, str(project_root or "")]
        extra = (str(project_root),) if project_root else ()
        out = subprocess.run(
            info.command(argv, scratch, extra), capture_output=True, text=True, timeout=60, env=minimal_env(iso.scratch_env(scratch)),
        )
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1]), canary


@needs_landlock
def test_landlock_confines_reads_writes_and_deletes_to_the_scratch_directory(tmp_path):
    report, canary = _enforce(tmp_path)
    assert report["read_outside"] == "denied" and report["list_outside"] == "denied"
    assert report["write_outside"] == "denied" and report["delete_outside"] == "denied"
    assert report["write_scratch"] == "ok" and report["delete_scratch"] == "ok"
    assert (canary / "secret.txt").read_text() == "SECRET" and not (canary / "new.txt").exists()


@needs_landlock
@pytest.mark.skipif(landlock.abi_version() < 4, reason="TCP rules need Landlock ABI 4")
def test_landlock_denies_tcp_connect_and_bind(tmp_path):
    report, _ = _enforce(tmp_path)
    assert report["connect"] == "denied" and report["bind"] == "denied"


@needs_landlock
def test_landlock_grants_the_project_root_read_only_on_request(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    (project / "data.txt").write_text("rows")
    report, _ = _enforce(tmp_path, project_root=project)
    assert report["read_project"] == "ok" and report["write_project"] == "denied"
    assert not (project / "new.txt").exists()


@needs_landlock
def test_landlock_launcher_failure_exits_71_with_a_recognisable_prefix(capsys):
    assert landlock.main(["landlock.py", "{not json", "--", "true"]) == landlock.EXIT_LANDLOCK_FAILED
    assert landlock.main(["landlock.py", json.dumps({"abi": 0}), "--", "true"]) == landlock.EXIT_LANDLOCK_FAILED
    assert landlock.main(["landlock.py"]) == landlock.EXIT_LANDLOCK_FAILED
    assert capsys.readouterr().err.count("landlock:") == 3


@needs_landlock
def test_a_landlock_candidate_runs_and_reports_the_observed_tier():
    info = _tier("landlock")
    info = iso.IsolationInfo(
        iso.MODE_LANDLOCK, info.wrap, scratch_aware=True, reads="restricted", writes="scratch-only",
        network="denied" if landlock.denies_tcp(landlock.abi_version()) else "unrestricted",
    )
    response = run_candidate(default_request("stim_circuit", GOOD, "build", [{"args": [3, 3], "kwargs": {}}]),
                             wall_seconds=120, isolation=info)
    assert response["status"] == "ok", response
    assert response["isolation"] == "landlock"
    assert response["isolation_detail"]["reads"] == "restricted" and response["isolation_detail"]["writes"] == "scratch-only"


# --- a candidate calling shutil.rmtree(<dir outside scratch>) is denied or rejected, per tier ---

RMTREE = (
    "import shutil, stim\n"
    "def build():\n"
    "    try:\n"
    "        shutil.rmtree({victim!r})\n"
    "        print('DELETED')\n"
    "    except OSError as exc:\n"
    "        print('DENIED:' + type(exc).__name__)\n"
    "    return stim.Circuit('H 0')\n"
)


@pytest.mark.parametrize("tier", ["landlock", "bwrap", "sandbox-exec", "process"])
def test_landlock_denies_rmtree(tier, tmp_path):
    """The name is the plan's: every tier either denies the delete (OS) or rejects the program (pre-screen)."""
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.txt").write_text("important")
    info = _tier(tier)
    # OS tiers get NO pre-screen help (a trusted origin): the sandbox alone must stop the delete.
    origin = "claude" if tier == "process" else "user"
    request = default_request("stim_circuit", RMTREE.format(victim=str(victim)), "build", CALL)
    response = run_candidate(request, wall_seconds=120, isolation=info, origin=origin)
    assert (victim / "keep.txt").read_text() == "important", response
    if tier == "process":
        assert response["status"] == "error" and response["error"]["code"] == ERR_PRESCREEN
    else:
        assert response["status"] == "ok", response
        assert response["stdout"].startswith("DENIED:"), response["stdout"]


@needs_landlock
def test_wrapper_failure_falls_back_to_process_with_the_prescreen_applied(tmp_path):
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.txt").write_text("important")
    broken = iso.IsolationInfo(
        iso.MODE_LANDLOCK,
        lambda cmd, scratch=None, extra_ro=(): [sys.executable, "-c", "import sys; sys.stderr.write('landlock: boom'); sys.exit(71)"],
        scratch_aware=True,
    )
    hostile = run_candidate(
        default_request("stim_circuit", RMTREE.format(victim=str(victim)), "build", CALL), wall_seconds=60, isolation=broken,
        origin="user",  # trusted: only the fallback to a plain process brings the pre-screen in
    )
    assert hostile["error"]["code"] == ERR_PRESCREEN and hostile["isolation"] == "process"
    assert (victim / "keep.txt").exists()
    clean = run_candidate(default_request("stim_circuit", GOOD, "build", [{"args": [3, 3], "kwargs": {}}]),
                          wall_seconds=120, isolation=broken, origin="user")
    assert clean["status"] == "ok" and clean["isolation"] == "process"
    assert clean["isolation_detail"] == PROCESS_DETAIL


# --- SIGTERM-then-SIGKILL for jobs with children ---------------------------------------------------


def _spawn_group(script: str) -> subprocess.Popen:
    proc = subprocess.Popen(["sh", "-c", script], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    threading.Thread(target=proc.wait, daemon=True).start()  # reap the leader so the group can empty
    time.sleep(0.3)  # let the shell install its traps and start its child
    return proc


def _group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    return True


def test_kill_process_group_terminates_politely_first():
    proc = _spawn_group("sleep 60 & wait")
    started = time.monotonic()
    assert kill_process_group(proc.pid, grace_seconds=5.0) is True  # SIGTERM was enough
    assert time.monotonic() - started < 4.0
    assert not _group_alive(proc.pid)


def test_kill_process_group_escalates_to_sigkill_for_children_that_ignore_sigterm():
    proc = _spawn_group("trap '' TERM; (trap '' TERM; sleep 60) & wait")
    assert kill_process_group(proc.pid, grace_seconds=0.4) is False  # needed SIGKILL
    deadline = time.monotonic() + 5
    while _group_alive(proc.pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not _group_alive(proc.pid), "no descendant may outlive the group kill"


def test_kill_process_group_on_a_gone_group_is_a_no_op():
    proc = subprocess.Popen(["true"], start_new_session=True)
    proc.wait()
    assert kill_process_group(proc.pid, grace_seconds=0.1) is True


# --- per-request isolation consent on process-only hosts (kernel side of the consent dialog) ---

pytest.importorskip("pymatching")

from kernel.discovery import manager as manager_module  # noqa: E402
from kernel.discovery.manager import DiscoveryManager  # noqa: E402
from kernel.tests.test_discovery_handlers import evaluate_msg, evaluations, is_type, session  # noqa: E402

SIMPLE = "import stim\ndef build(d, r):\n    return stim.Circuit('H 0')\n"
SANDBOX_CALLS: list[dict] = []


def _recording_sandbox(request, *, wall_seconds, cancel_event=None, origin=None):
    SANDBOX_CALLS.append(request)
    return {"status": "error", "artifacts": [], "stdout": "", "stderr": "", "isolation": "process",
            "error": {"code": "worker_no_output", "message": "stub"}}


def _install_manager(tmp_path, info: iso.IsolationInfo) -> DiscoveryManager:
    SANDBOX_CALLS.clear()
    manager = DiscoveryManager(
        max_workers=1, cache_dir=str(tmp_path / "cache"), sandbox_runner=_recording_sandbox, isolation_provider=lambda: info,
    )
    manager_module.set_manager(manager)
    return manager


@pytest.fixture
def _process_only_host(tmp_path):
    manager = _install_manager(tmp_path, iso.IsolationInfo(iso.MODE_PROCESS, note="no OS sandbox here"))
    yield manager
    manager_module.set_manager(None)


@pytest.mark.asyncio
async def test_evaluate_without_consent_on_a_process_host_asks_for_it(_process_only_host):
    ws = await session([evaluate_msg(SIMPLE, candidate_id="c-9", run_id="run-9")], [lambda m: m.get("type") == "error"])
    (error,) = [m for m in ws.sent if m["type"] == "error"]
    assert error["code"] == "isolation_consent_required" and error["phase"] == "discovery"
    assert error["run_id"] == "run-9" and error["candidate_id"] == "c-9"
    assert error["message"] == iso.PROCESS_CAPABILITY_TEXT == error["capability_text"]
    assert error["isolation"] == "process"
    assert not any(m["type"] == "discovery_evaluate_accepted" for m in ws.sent)
    assert SANDBOX_CALLS == []


@pytest.mark.asyncio
async def test_evaluate_with_consent_runs_on_a_process_host(_process_only_host):
    ws = await session(
        [evaluate_msg(SIMPLE, isolation_consent=True)], [is_type("discovery_evaluate_accepted"), is_type("discovery_evaluation")],
    )
    assert len(SANDBOX_CALLS) == 1
    assert evaluations(ws)["c-1"]["failure"]["code"] == "worker_no_output"


@pytest.mark.asyncio
async def test_consent_is_not_remembered_between_requests(_process_only_host):
    first = await session([evaluate_msg(SIMPLE, isolation_consent=True)], [is_type("discovery_evaluation")])
    assert "c-1" in evaluations(first)
    second = await session([evaluate_msg(SIMPLE, candidate_id="c-2")], [lambda m: m.get("type") == "error"])
    assert [m["code"] for m in second.sent if m["type"] == "error"] == ["isolation_consent_required"]


@pytest.mark.asyncio
async def test_an_os_sandbox_needs_no_consent(tmp_path):
    _install_manager(tmp_path, iso.IsolationInfo(iso.MODE_LANDLOCK, reads="restricted", writes="scratch-only"))
    try:
        ws = await session([evaluate_msg(SIMPLE)], [is_type("discovery_evaluation")])
    finally:
        manager_module.set_manager(None)
    assert evaluations(ws)["c-1"]["failure"]["code"] == "worker_no_output"
    assert len(SANDBOX_CALLS) == 1


@pytest.mark.asyncio
async def test_a_malformed_consent_flag_is_an_invalid_request(_process_only_host):
    ws = await session([evaluate_msg(SIMPLE, isolation_consent="yes")], [lambda m: m.get("type") == "error"])
    assert [m["code"] for m in ws.sent if m["type"] == "error"] == ["invalid_request"]


@pytest.mark.asyncio
async def test_an_unknown_origin_is_an_invalid_request(_process_only_host):
    ws = await session([evaluate_msg(SIMPLE, isolation_consent=True, origin="mallory")], [lambda m: m.get("type") == "error"])
    assert [m["code"] for m in ws.sent if m["type"] == "error"] == ["invalid_request"]


@pytest.mark.asyncio
async def test_the_prescreen_rejects_before_the_sandbox_and_consent_does_not_bypass_it(_process_only_host):
    hostile = "import shutil, stim\ndef build(d, r):\n    shutil.rmtree('/tmp/not-yours')\n    return stim.Circuit('H 0')\n"
    ws = await session([evaluate_msg(hostile, isolation_consent=True)], [is_type("discovery_evaluation")])
    failure = evaluations(ws)["c-1"]["failure"]
    assert failure["stage"] == "sandbox" and failure["code"] == ERR_PRESCREEN
    assert failure["message"].startswith("prescreen: shutil")
    assert SANDBOX_CALLS == []


ORIGINS_SEEN: list = []


def _origin_recording_sandbox(request, *, wall_seconds, cancel_event=None, origin=None):
    ORIGINS_SEEN.append(origin)
    return _recording_sandbox(request, wall_seconds=wall_seconds, cancel_event=cancel_event)


@pytest.mark.asyncio
async def test_the_manager_hands_the_request_origin_to_the_sandbox(tmp_path):
    ORIGINS_SEEN.clear()
    manager = _install_manager(tmp_path, iso.IsolationInfo(iso.MODE_LANDLOCK, reads="restricted", writes="scratch-only"))
    manager._sandbox = _origin_recording_sandbox
    try:
        await session(
            [evaluate_msg(SIMPLE, candidate_id="c-u", origin="user"), evaluate_msg(SIMPLE, candidate_id="c-n")],
            [is_type("discovery_evaluation", candidate_id="c-u"), is_type("discovery_evaluation", candidate_id="c-n")],
        )
    finally:
        manager_module.set_manager(None)
    assert sorted(ORIGINS_SEEN) == ["claude", "user"], "a trusted origin must reach run_candidate; a missing one is 'claude'"


@pytest.mark.asyncio
async def test_untrusted_origin_is_prescreened_even_under_an_os_sandbox(tmp_path):
    _install_manager(tmp_path, iso.IsolationInfo(iso.MODE_LANDLOCK, reads="restricted", writes="scratch-only"))
    hostile = "import stim\ndef build(d, r):\n    open('/tmp/x', 'w')\n    return stim.Circuit('H 0')\n"
    try:
        ws = await session(
            [evaluate_msg(hostile, candidate_id="c-claude", origin="claude"), evaluate_msg(hostile, candidate_id="c-user", origin="user")],
            [is_type("discovery_evaluation", candidate_id="c-claude"), is_type("discovery_evaluation", candidate_id="c-user")],
        )
    finally:
        manager_module.set_manager(None)
    done = evaluations(ws)
    assert done["c-claude"]["failure"]["code"] == ERR_PRESCREEN
    assert done["c-user"]["failure"]["code"] == "worker_no_output", "a user's own code is trusted under an OS sandbox"


# --- the Red Queen audit path: same consent gate, same pre-screen, a missing origin is untrusted ---

from kernel.discovery.audits import runner as audit_runner  # noqa: E402
from kernel.discovery.audits.runner import AuditManager  # noqa: E402
from kernel.tests.test_discovery_audit_protocol import audit_msg, canned  # noqa: E402

HOSTILE_AUDIT_PROGRAM = "import shutil\ndef build(d, r):\n    shutil.rmtree('/tmp/not-yours')\n"
AUDIT_RUNS: list = []


def _install_audit_manager() -> None:
    AUDIT_RUNS.clear()
    inner = canned()

    def run(request, cancel_event, *, cache_dir=None):
        AUDIT_RUNS.append(request)
        return inner(request, cancel_event, cache_dir=cache_dir)

    audit_runner.set_audit_manager(AuditManager(max_workers=1, job_runner=run))


def _errors(ws) -> list[dict]:
    return [m for m in ws.sent if m["type"] == "error"]


@pytest.fixture
def _audit_on_a_process_host(_process_only_host):
    _install_audit_manager()
    yield
    audit_runner.set_audit_manager(None)


@pytest.mark.asyncio
async def test_audit_without_consent_on_a_process_host_asks_for_it(_audit_on_a_process_host):
    ws = await session([audit_msg(candidate_id="c-9", run_id="run-9")], [lambda m: m.get("type") == "error"])
    (error,) = _errors(ws)
    assert error["code"] == "isolation_consent_required" and error["phase"] == "discovery"
    assert error["run_id"] == "run-9" and error["candidate_id"] == "c-9"
    assert error["message"] == iso.PROCESS_CAPABILITY_TEXT == error["capability_text"]
    assert not any(m["type"] == "discovery_audit_accepted" for m in ws.sent)
    assert AUDIT_RUNS == [], "no audit may start without consent"


@pytest.mark.asyncio
async def test_audit_with_consent_runs_on_a_process_host(_audit_on_a_process_host):
    ws = await session(
        [audit_msg(isolation_consent=True)], [is_type("discovery_audit_accepted"), is_type("discovery_audit_result")],
    )
    assert _errors(ws) == [] and len(AUDIT_RUNS) == 1


@pytest.mark.asyncio
async def test_audit_consent_is_not_remembered_between_requests(_audit_on_a_process_host):
    await session([audit_msg(isolation_consent=True)], [is_type("discovery_audit_result")])
    second = await session([audit_msg(candidate_id="c-2")], [lambda m: m.get("type") == "error"])
    assert [m["code"] for m in _errors(second)] == ["isolation_consent_required"]


@pytest.mark.asyncio
async def test_audit_prescreen_rejects_a_hostile_program_even_with_consent(_audit_on_a_process_host):
    msg = {**audit_msg(isolation_consent=True), "program": HOSTILE_AUDIT_PROGRAM}
    ws = await session([msg], [lambda m: m.get("type") == "error"])
    (error,) = _errors(ws)
    assert error["code"] == ERR_PRESCREEN and error["message"].startswith("prescreen: shutil")
    assert not any(m["type"] == "discovery_audit_accepted" for m in ws.sent)
    assert AUDIT_RUNS == []


@pytest.mark.asyncio
async def test_audit_prescreens_an_untrusted_origin_under_an_os_sandbox_and_trusts_a_user(tmp_path):
    _install_manager(tmp_path, iso.IsolationInfo(iso.MODE_LANDLOCK, reads="restricted", writes="scratch-only"))
    _install_audit_manager()
    hostile = {**audit_msg(), "program": HOSTILE_AUDIT_PROGRAM}
    try:
        untrusted = await session([hostile], [lambda m: m.get("type") == "error"])
        default = await session([{**hostile, "candidate_id": "c-2"}], [lambda m: m.get("type") == "error"])
        trusted = await session([{**hostile, "origin": "user"}], [is_type("discovery_audit_result")])
    finally:
        manager_module.set_manager(None)
        audit_runner.set_audit_manager(None)
    assert [m["code"] for m in _errors(untrusted)] == [ERR_PRESCREEN], "no origin means untrusted"
    assert [m["code"] for m in _errors(default)] == [ERR_PRESCREEN]
    assert _errors(trusted) == [] and len(AUDIT_RUNS) == 1


@pytest.mark.asyncio
async def test_audit_rejects_a_malformed_consent_flag_and_an_unknown_origin(_audit_on_a_process_host):
    bad_flag = await session([audit_msg(isolation_consent="yes")], [lambda m: m.get("type") == "error"])
    bad_origin = await session([audit_msg(isolation_consent=True, origin="mallory")], [lambda m: m.get("type") == "error"])
    assert [m["code"] for m in _errors(bad_flag)] == ["invalid_request"]
    assert [m["code"] for m in _errors(bad_origin)] == ["invalid_request"]


@pytest.mark.parametrize("mode", [iso.MODE_PROCESS, iso.MODE_LANDLOCK])
def test_run_candidate_treats_a_missing_origin_as_untrusted(mode):
    request = default_request("stim_circuit", HOSTILE_AUDIT_PROGRAM, "build", [{"args": [3, 3], "kwargs": {}}])
    info = iso.IsolationInfo(mode)
    for origin in (None, "claude"):
        response = run_candidate(request, wall_seconds=30, isolation=info, origin=origin)
        assert response["status"] == "error" and response["error"]["code"] == ERR_PRESCREEN
