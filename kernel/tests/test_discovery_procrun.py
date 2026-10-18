"""Process-group hygiene of the shared runner."""

from __future__ import annotations

import os
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
