"""Process-group hygiene of the shared runner."""

from __future__ import annotations

import os
import sys
import threading
import time

from kernel.discovery.procrun import run_process


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _spawn_sleeper(tmp_path, **kw):
    pidfile = tmp_path / "pid"
    command = ["sh", "-c", f"sleep 60 & echo $! > {pidfile}; wait"]
    cancel = threading.Event()
    threading.Timer(0.7, cancel.set).start()
    result = run_process(command, b"", wall_seconds=30, cancel_event=cancel, **kw)
    return result, int(pidfile.read_text())


def test_cancel_kills_grandchildren_with_their_group(tmp_path):
    result, grandchild = _spawn_sleeper(tmp_path)
    assert result.cancelled
    deadline = time.monotonic() + 30
    while _alive(grandchild) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not _alive(grandchild)


def test_timeout_is_reported_and_normal_exit_is_clean():
    assert run_process(["sleep", "30"], b"", wall_seconds=0.5).timed_out
    ok = run_process(["cat"], b"hello", wall_seconds=60)
    assert ok.stdout == b"hello" and ok.returncode == 0 and not ok.timed_out


def test_spawn_failure_is_reported_not_raised():
    result = run_process(["/definitely/not/a/binary"], b"", wall_seconds=5)
    assert result.spawn_error


def _wait_dead(pid: int, seconds: float = 30) -> bool:
    deadline = time.monotonic() + seconds
    while _alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    return not _alive(pid)


def test_group_is_killed_after_a_normal_worker_exit(tmp_path):
    # RT-M3: the worker exits cleanly but leaves a background child holding the pipes.
    pidfile = tmp_path / "pid"
    command = ["sh", "-c", f"sleep 60 & echo $! > {pidfile}; echo done"]
    start = time.monotonic()
    result = run_process(command, b"", wall_seconds=30)
    assert result.stdout.strip() == b"done" and result.returncode == 0
    assert time.monotonic() - start < 15  # did not wait for the sleeper's pipe
    assert _wait_dead(int(pidfile.read_text()))


def test_output_flood_is_cut_at_cap_plus_one_and_kills_the_group():
    # CR-H3: 600 MB flood must never be buffered.
    command = ["sh", "-c", "yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]
    result = run_process(command, b"", wall_seconds=60, max_output_bytes=1_000_000)
    assert result.output_overflow
    assert len(result.stdout) == 1_000_001
    assert not result.timed_out


def test_stderr_flood_is_bounded_too():
    command = ["sh", "-c", "yes e >&2"]
    result = run_process(command, b"", wall_seconds=60)
    assert result.output_overflow
    assert len(result.stderr) <= 4096


def test_large_stdin_payload_does_not_deadlock():
    payload = b"a" * 3_000_000
    result = run_process(["cat"], payload, wall_seconds=60, max_output_bytes=4_000_000)
    assert result.stdout == payload


def test_memory_watchdog_kills_group_over_the_threshold():
    # RT-M1: low threshold (200 MB); the child touches ~600 MB at most.
    script = "import time\nb = bytearray(400 * 1024 * 1024)\nfor i in range(0, len(b), 4096): b[i] = 1\ntime.sleep(60)\n"
    start = time.monotonic()
    result = run_process([sys.executable, "-c", script], b"", wall_seconds=60, memory_limit=200 * 1024 * 1024)
    assert result.memory_exceeded and not result.timed_out
    assert time.monotonic() - start < 30


def test_memory_limit_env_override(monkeypatch):
    from kernel.discovery.procrun import DEFAULT_MEMORY_LIMIT_BYTES, memory_limit_bytes

    assert memory_limit_bytes() == DEFAULT_MEMORY_LIMIT_BYTES == 4 * 1024 ** 3
    monkeypatch.setenv("NUCLEI_DISCOVERY_MAX_RSS_MB", "300")
    assert memory_limit_bytes() == 300 * 1024 * 1024
    monkeypatch.setenv("NUCLEI_DISCOVERY_MAX_RSS_MB", "junk")
    assert memory_limit_bytes() == DEFAULT_MEMORY_LIMIT_BYTES


# The pre-switch-over environment of ``procrun.minimal_env`` (sandbox and scorer launches), frozen as a literal.
_LEGACY_STRICT_KEYS = {
    "PATH", "LANG", "PYTHONNOUSERSITE", "PYTHONHASHSEED", "OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS",
    "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "RAYON_NUM_THREADS",
}


def _legacy_minimal_env(extra=None):
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "PYTHONNOUSERSITE": "1",
        "PYTHONHASHSEED": "0",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
        "RAYON_NUM_THREADS": "1",
    }
    if extra:
        env.update(extra)
    return env


def test_minimal_env_matches_the_pre_lab_proc_environment(monkeypatch):
    from kernel.discovery.procrun import minimal_env

    monkeypatch.setenv("PATH", "/opt/bin:/usr/bin")
    monkeypatch.setenv("LANG", "en_US.UTF-8")
    for secret in ("HOME", "TMPDIR", "ANTHROPIC_API_KEY", "LC_ALL"):
        monkeypatch.setenv(secret, "leak")
    scratch = {"TMPDIR": "/scratch", "HOME": "/scratch", "NUCLEI_X": "1"}
    for extra in (None, scratch):
        new, old = minimal_env(extra), _legacy_minimal_env(extra)
        # The only addition is the shared PYTHONDONTWRITEBYTECODE=1 (stricter; nothing may write bytecode).
        assert {k: v for k, v in new.items() if k != "PYTHONDONTWRITEBYTECODE"} == old
        assert new["PYTHONDONTWRITEBYTECODE"] == "1"
    assert set(minimal_env()) == _LEGACY_STRICT_KEYS | {"PYTHONDONTWRITEBYTECODE"}
    assert "ANTHROPIC_API_KEY" not in minimal_env(scratch)


def test_minimal_env_defaults_when_parent_has_no_path_or_lang(monkeypatch):
    from kernel.discovery.procrun import minimal_env

    monkeypatch.delenv("PATH", raising=False)
    monkeypatch.delenv("LANG", raising=False)
    env = minimal_env()
    assert (env["PATH"], env["LANG"]) == ("/usr/bin:/bin", "C.UTF-8")


def test_procrun_uses_the_shared_kill_helper():
    from kernel import lab_proc
    from kernel.discovery import procrun

    assert procrun.kill_process_group is lab_proc.kill_process_group
