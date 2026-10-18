"""CR-M9: job-manager robustness shared by the trainability and conjecture managers."""

from __future__ import annotations

import asyncio
import json
import os
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

pytest.importorskip("qiskit")

from kernel.discovery.conjecture import jobs as cjobs  # noqa: E402
from kernel.discovery.conjecture import worker as cworker  # noqa: E402
from kernel.discovery.conjecture.jobs import ConjectureJobManager  # noqa: E402
from kernel.lab_proc import iter_pipe_lines  # noqa: E402
from kernel.tests._trainability_job_helpers import (  # noqa: E402
    FAKE_MODULE,
    QISKIT_CODE,
    connection,
    pid_alive,
    write_fake_analyses,
)
from kernel.tests.test_discovery_conjecture_protocol import CLAIM, FAKE_MODULE as CJ_FAKE_MODULE  # noqa: E402
from kernel.tests.test_discovery_conjecture_protocol import FAKE_SOURCE as CJ_FAKE_SOURCE  # noqa: E402
from kernel.trainability import job_worker, jobs  # noqa: E402
from kernel.trainability.jobs import TrainabilityJobManager  # noqa: E402

GRANDCHILD_SEED, CPU_SEED = 999, 555
REPO = str(Path(__file__).resolve().parents[2])


class Ctx:
    owner = 1

    def __init__(self) -> None:
        self.sent: list[dict] = []

    def emit_threadsafe(self, payload: dict) -> None:
        self.sent.append(payload)

    def on_release(self, key, hook) -> None: ...

    def forget(self, key) -> None: ...


def _trn_manager(tmp_path, **kwargs) -> TrainabilityJobManager:
    write_fake_analyses(tmp_path)
    return TrainabilityJobManager(extra_env={job_worker.OVERRIDE_ENV: FAKE_MODULE},
                                  extra_sys_path=[str(tmp_path)], **kwargs)


@pytest.fixture
def trn_manager(tmp_path):
    previous = jobs.get_manager()
    created: list[TrainabilityJobManager] = []

    def factory(**kwargs):
        manager = _trn_manager(tmp_path, **kwargs)
        created.append(manager)
        jobs.set_manager(manager)
        return manager

    yield factory
    for manager in created:
        manager.release_all()
    jobs.set_manager(previous)


def _start(job_id: str, seed: int, **extra) -> dict:
    return {"type": "trainability_start", "job_id": job_id, "code": QISKIT_CODE, "observable": "Z0*Z1",
            "analyses": ["gradients"], "settings": {"seed": seed}, **extra}


# ------------------------------------------------- grandchild holds stdout


def test_trainability_job_finishes_even_when_a_grandchild_holds_stdout(trn_manager):
    manager = trn_manager(drain_grace_s=0.5)

    async def scenario():
        async with connection() as ws:
            ws.push(_start("gc", GRANDCHILD_SEED))
            started = time.monotonic()
            result = await ws.wait_type("trainability_result", timeout=6)
            return result, time.monotonic() - started

    result, took = asyncio.run(scenario())
    assert took < 6 and result["status"] == "complete" and "gradients" in result["results"]
    assert manager.running() == 0, "the slot must be released"


def test_conjecture_job_finishes_even_when_a_grandchild_holds_stdout(tmp_path):
    source = CJ_FAKE_SOURCE.replace('        mode = conjecture["id"]\n', '''        mode = conjecture["id"]
        if mode == "grandchild":
            import os, stat, subprocess, sys
            fds = []
            for fd in range(3, 64):
                try:
                    if stat.S_ISFIFO(os.fstat(fd).st_mode):
                        os.set_inheritable(fd, True)
                        fds.append(fd)
                except OSError:
                    pass
            subprocess.Popen([sys.executable, "-c", "import time; time.sleep(8)"], pass_fds=fds,
                             start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
''')
    (tmp_path / f"{CJ_FAKE_MODULE}.py").write_text(source, encoding="utf-8")
    manager = ConjectureJobManager(extra_env={cworker.OVERRIDE_ENV: CJ_FAKE_MODULE},
                                   extra_sys_path=[str(tmp_path)], drain_grace_s=0.5)
    previous = cjobs.set_manager(manager)

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "discovery_conjecture_test", "job_id": "gc", "conjecture": {**CLAIM, "id": "grandchild"}})
            return await ws.wait_type("discovery_conjecture_result", timeout=6)

    try:
        result = asyncio.run(scenario())
    finally:
        manager.release_all()
        cjobs.set_manager(previous)
    assert result["status"] == "complete"
    assert manager.running() == 0


# ------------------------------------------- cancel never beats a result


def test_late_cancel_does_not_override_a_completed_trainability_job(tmp_path):
    manager = _trn_manager(tmp_path)
    ctx = Ctx()
    request = {"job_id": "j", "code": "x", "observable": "Z0", "analyses": ["gradients"],
               "settings": {"backend": "auto"}}
    job = jobs._Job("j", 1, ctx, request=request)
    manager._handle_event(job, {"event": "partial", "analysis": "gradients", "result": {"v": 1}}, ctx.emit_threadsafe)
    manager._handle_event(job, {"event": "done"}, ctx.emit_threadsafe)
    manager._jobs["j"] = job
    assert manager.cancel(1, "j") is False
    manager._kill(job, cancelled=True)  # e.g. the connection closed a moment later
    message = manager._terminal_message(job)
    assert message["status"] == "complete" and message["results"] == {"gradients": {"v": 1}}


def test_cancel_racing_a_result_already_in_the_pipe_still_reports_complete(tmp_path):
    """The kill lands before the reader has consumed the final lines."""
    manager = _trn_manager(tmp_path)
    ctx = Ctx()
    request = {"job_id": "j", "code": "x", "observable": "Z0", "analyses": ["gradients"],
               "settings": {"backend": "auto"}}
    job = jobs._Job("j", 1, ctx, request=request)
    manager._kill(job, cancelled=True)
    manager._handle_event(job, {"event": "partial", "analysis": "gradients", "result": {"v": 1}}, ctx.emit_threadsafe)
    manager._handle_event(job, {"event": "done"}, ctx.emit_threadsafe)
    assert manager._terminal_message(job)["status"] == "complete"


def test_late_cancel_does_not_override_a_completed_conjecture_job():
    manager = ConjectureJobManager()
    ctx = Ctx()
    job = cjobs._Job("c", 1, ctx, conjecture=CLAIM, seed=0)
    manager._kill(job, cancelled=True)
    manager._handle_event(job, {"event": "result", "result": {"verdict": "supported"}}, ctx.emit_threadsafe)
    message = manager._terminal_message(job)
    assert message["status"] == "complete" and message["result"] == {"verdict": "supported"}
    manager._jobs["c"] = job
    assert manager.cancel(1, "c") is False


# ------------------------------------------- malformed protocol lines


def _feed(manager, job, lines: list[bytes]) -> None:
    read_fd, write_fd = os.pipe()
    job.proc = SimpleNamespace(stdout=os.fdopen(read_fd, "rb"), stderr=None)
    os.write(write_fd, b"".join(lines))
    os.close(write_fd)
    import threading

    manager._read_stdout(job, threading.Event(), job.ctx.emit_threadsafe)
    job.proc.stdout.close()


def test_malformed_lines_are_skipped_and_reported_not_fatal(tmp_path):
    manager = _trn_manager(tmp_path)
    ctx = Ctx()
    job = jobs._Job("j", 1, ctx, request={"analyses": ["gradients"]})
    good = json.dumps({"event": "partial", "analysis": "gradients", "result": {"v": 1}}).encode()
    _feed(manager, job, [
        b"not json at all\n",
        b"[1, 2, 3]\n",                              # valid JSON, not an object
        b'{"event": "progress"}\n',                  # missing keys
        b'{"event": "partial", "analysis": "gradients"}\n',  # missing result
        good + b"\n",
    ])
    assert job.results == {"gradients": {"v": 1}}, "the loop must survive and keep reading"
    assert job.malformed_lines == 4
    assert any("malformed" in line for line in job.stderr_tail)


def test_conjecture_malformed_lines_are_skipped_and_reported():
    manager = ConjectureJobManager()
    ctx = Ctx()
    job = cjobs._Job("c", 1, ctx, conjecture=CLAIM, seed=0)
    _feed(manager, job, [b'{"event": "evidence"}\n', b"42\n",
                         b'{"event": "result", "result": {"verdict": "supported"}}\n'])
    assert job.result == {"verdict": "supported"} and job.malformed_lines == 2


def test_iter_pipe_lines_stops_on_flag_when_the_pipe_never_closes():
    import threading

    read_fd, write_fd = os.pipe()
    pipe = os.fdopen(read_fd, "rb")
    stop = threading.Event()
    os.write(write_fd, b"one\ntwo\npartial")
    seen: list[str] = []
    thread = threading.Thread(target=lambda: seen.extend(iter_pipe_lines(pipe, stop)), daemon=True)
    thread.start()
    time.sleep(0.4)
    stop.set()
    thread.join(2)
    os.close(write_fd)
    pipe.close()
    assert not thread.is_alive() and seen == ["one", "two"]


# ------------------------------------------- workers die with the kernel


def test_worker_exits_when_its_parent_is_sigkilled(tmp_path):
    child_script = tmp_path / "child.py"
    child_script.write_text(textwrap.dedent(f"""
        import os, sys, time
        sys.path.insert(0, {REPO!r})
        from kernel.lab_proc import start_parent_watch
        start_parent_watch(interval=0.1)
        print(os.getpid(), flush=True)
        time.sleep(60)
    """))
    parent_script = tmp_path / "parent.py"
    parent_script.write_text(textwrap.dedent(f"""
        import subprocess, sys, time
        child = subprocess.Popen([sys.executable, {str(child_script)!r}], stdout=subprocess.PIPE, text=True)
        print(child.stdout.readline().strip(), flush=True)
        time.sleep(60)
    """))
    parent = subprocess.Popen([sys.executable, str(parent_script)], stdout=subprocess.PIPE, text=True)
    child_pid = int(parent.stdout.readline())
    try:
        assert pid_alive(child_pid)
        parent.send_signal(signal.SIGKILL)
        parent.wait(10)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and _is_running(child_pid):
            time.sleep(0.1)
        assert not _is_running(child_pid), "the orphaned worker must exit on its own"
    finally:
        if _is_running(child_pid):
            os.kill(child_pid, signal.SIGKILL)


def _is_running(pid: int) -> bool:
    """Alive and not a zombie."""
    if not pid_alive(pid):
        return False
    state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith("Z")


def test_release_all_kills_every_running_job(trn_manager):
    manager = trn_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(_start("hang", 777))
            await ws.wait_type("trainability_started")
            pids = manager.pids()
            assert pids
            manager.release_all()  # what the kernel's atexit hook calls
            await ws.wait_type("trainability_result", timeout=20)
            return pids

    pids = asyncio.run(scenario())
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and any(_is_running(p) for p in pids):
        time.sleep(0.1)
    assert not any(_is_running(p) for p in pids)


def test_shutdown_hooks_are_registered():
    import atexit  # noqa: F401

    assert callable(jobs._release_at_exit) and callable(cjobs._release_at_exit)


# ------------------------------------------------------- CPU rlimit


def test_trainability_worker_has_a_generous_cpu_rlimit(trn_manager):
    trn_manager()

    async def scenario():
        async with connection() as ws:
            ws.push(_start("cpu", CPU_SEED))
            return await ws.wait_type("trainability_result", timeout=60)

    result = asyncio.run(scenario())
    soft, hard = result["results"]["gradients"]["cpu_limit"]
    assert soft == 30 * 60 and hard >= soft


def test_cpu_limit_kill_is_reported_as_cpu_limit(tmp_path):
    manager = _trn_manager(tmp_path)
    ctx = Ctx()
    job = jobs._Job("j", 1, ctx, request={"job_id": "j", "analyses": ["gradients"], "settings": {}, "code": "x"})
    job.proc = SimpleNamespace(returncode=-signal.SIGXCPU, pid=0)
    manager._fill_unfinished(job, cancelled=False)
    assert job.errors["gradients"]["code"] == "cpu_limit"
