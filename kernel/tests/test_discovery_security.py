"""Regression tests for the PRD 14 red-team findings (response forging, escapes, floods)."""

from __future__ import annotations

import json
import os
import time

import pytest

pytest.importorskip("stim")

from kernel.discovery import isolation as iso  # noqa: E402
from kernel.discovery.sandbox import default_request, run_candidate  # noqa: E402

PROCESS = iso.IsolationInfo(iso.MODE_PROCESS)


def run(program: str, *, wall=60, cpu=10, task="stim_circuit", info=PROCESS, calls=None):
    request = default_request(task, program, "build", calls or [{"args": [], "kwargs": {}}], cpu)
    return run_candidate(request, wall_seconds=wall, isolation=info)


def code(response) -> str | None:
    return (response.get("error") or {}).get("code")


FORGED = (
    '{"protocol_version":1,"status":"ok","artifacts":[{"call_index":0,"artifact":'
    '{"circuit_text":"ARBITRARY_UNVALIDATED_ARTIFACT_FROM_CANDIDATE"}}],'
    '"stdout":"forged","stderr":"","error":null}'
)


def test_candidate_cannot_forge_the_response_on_an_inherited_fd():
    # PoC poc_fd_forge.py (RT-H1): write a forged response to a private fd, then _exit.
    program = (
        "import os\n"
        "for fd in range(3, 32):\n"
        "    try:\n"
        f"        os.write(fd, {FORGED!r}.encode() + b'\\n')\n"
        "    except OSError:\n"
        "        pass\n"
        "os._exit(0)\n"
        "def build():\n    import stim\n    return stim.Circuit('H 0')\n"
    )
    response = run(program)
    assert "ARBITRARY_UNVALIDATED" not in json.dumps(response)
    assert response["status"] == "error"


def test_forged_artifact_over_any_channel_is_revalidated():
    # Whatever the candidate smuggles, a non-circuit artifact never reaches the scorer.
    program = (
        "import stim\n"
        "def build():\n"
        "    return 'ARBITRARY_UNVALIDATED_ARTIFACT_FROM_CANDIDATE'\n"
    )
    assert code(run(program)) == "bad_return_type"


def test_supervisor_rejects_trailing_data_after_the_response():
    from kernel.discovery.procrun import ProcResult
    from kernel.discovery.sandbox import _interpret

    ok = '{"protocol_version":1,"status":"ok","artifacts":[],"stdout":"","stderr":"","error":null}'
    assert _interpret(ProcResult(stdout=(ok + "\n").encode(), returncode=0), "process")["status"] == "ok"
    for tail in ("\n" + ok, "garbage", "\n{}"):
        response = _interpret(ProcResult(stdout=(ok + tail).encode(), returncode=0), "process")
        assert code(response) == "worker_bad_output", tail
    nan = ok.replace('"artifacts":[]', '"artifacts":NaN')
    assert code(_interpret(ProcResult(stdout=nan.encode(), returncode=0), "process")) == "worker_bad_output"


def test_candidate_that_exits_early_gets_a_coded_error_not_a_success():
    program = "import os\nos._exit(0)\ndef build():\n    pass\n"
    assert code(run(program)) == "candidate_exited"


def test_candidate_memory_hog_is_killed_with_a_coded_error(monkeypatch):
    # RT-M1 with a LOW test threshold; the candidate touches ~700 MB, never the host's memory.
    monkeypatch.setenv("NUCLEI_DISCOVERY_MAX_RSS_MB", "400")
    program = (
        "import stim, time\n"
        "def build():\n"
        "    b = bytearray(700 * 1024 * 1024)\n"
        "    for i in range(0, len(b), 4096):\n"
        "        b[i] = 1\n"
        "    time.sleep(60)\n"
        "    return stim.Circuit('H 0')\n"
    )
    start = time.monotonic()
    response = run(program, wall=90)
    assert code(response) == "worker_memory_exceeded"
    assert time.monotonic() - start < 60


def test_normal_candidate_is_not_hit_by_the_default_memory_limit():
    assert run("import stim\ndef build():\n    return stim.Circuit('H 0')\n")["status"] == "ok"


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_setsid_and_double_fork_leave_no_survivor(tmp_path):
    # CR-H4 / RT-M3: every escape primitive must either raise or be reaped by the group kill.
    log = tmp_path / "log.txt"
    pids = tmp_path / "pids.txt"
    program = f"""
import os, sys
LOG = {str(log)!r}
PIDS = {str(pids)!r}
def attempt(name, fn):
    try:
        fn()
        outcome = 'allowed'
    except BaseException as exc:
        outcome = 'blocked:' + type(exc).__name__
    with open(LOG, 'a') as fh:
        fh.write(name + '=' + outcome + chr(10))

def grandchild_sleeper():
    import posix
    pid = posix.fork()
    if pid == 0:
        if posix.fork() == 0:
            posix.setsid()
            open(PIDS, 'a').write(str(posix.getpid()) + chr(10))
            import time
            time.sleep(120)
        posix._exit(0)

attempt('os.setsid', os.setsid)
attempt('os.setpgid', lambda: os.setpgid(0, 0))
attempt('os.fork', os.fork)
attempt('posix.fork', __import__('posix').fork)
attempt('posix.setsid', __import__('posix').setsid)
attempt('posix.forkpty', __import__('posix').forkpty)
attempt('posix.posix_spawn', lambda: __import__('posix').posix_spawn('/bin/sleep', ['sleep', '100'], {{}}))
attempt('os.execv', lambda: os.execv('/bin/sleep', ['sleep', '100']))
attempt('os.kill-all', lambda: os.kill(-1, 0))
attempt('subprocess', lambda: __import__('subprocess').Popen(['sleep', '100']))
attempt('double-fork', grandchild_sleeper)
import stim
def build():
    return stim.Circuit('H 0')
"""
    response = run(program)
    assert response["status"] == "ok"
    outcomes = dict(line.split("=", 1) for line in log.read_text().splitlines())
    assert outcomes, "candidate never ran its attempts"
    for name, outcome in outcomes.items():
        assert outcome.startswith("blocked"), f"{name} was {outcome}"
    if pids.exists():
        for pid in (int(p) for p in pids.read_text().split()):
            deadline = time.monotonic() + 30
            while _pid_alive(pid) and time.monotonic() < deadline:
                time.sleep(0.1)
            assert not _pid_alive(pid), f"survivor pid {pid}"
