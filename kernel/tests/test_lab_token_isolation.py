"""The kernel's session token must never reach Lab subprocesses or candidate code.

Three layers, each tested here:

1. Env: every Lab worker (trainability / conjecture job workers, the candidate
   sandbox, the scorer) is spawned with a scrubbed environment even while the
   token is present in the kernel's own environment.
2. Files: ``~/.nuclei/runtime/kernel.json`` (which holds the token) is not
   readable from a sandboxed candidate.
3. Static: no subprocess is spawned anywhere in ``kernel/`` without an explicit
   ``env=`` argument (an omitted ``env`` inherits everything).
"""

from __future__ import annotations

import ast
import asyncio
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from kernel import auth
from kernel.lab_proc import minimal_env

KERNEL_DIR = Path(__file__).resolve().parents[1]
SECRET = "lab-isolation-secret-" + "z" * 32


class RecordingPopen(subprocess.Popen):
    """Popen that remembers the ``env`` each spawn asked for (``None`` means 'inherit')."""

    spawned: list[dict | None] = []
    commands: list[object] = []

    def __init__(self, *args, **kwargs):
        type(self).spawned.append(kwargs.get("env"))
        type(self).commands.append(args[0] if args else kwargs.get("args"))
        super().__init__(*args, **kwargs)


@pytest.fixture
def secret_in_kernel_env(monkeypatch):
    """Simulate a kernel whose process environment still holds the token (worst case)."""
    monkeypatch.setenv(auth.TOKEN_ENV, SECRET)
    monkeypatch.setenv(auth.INSECURE_ENV, "1")
    RecordingPopen.spawned = []
    RecordingPopen.commands = []
    monkeypatch.setattr(subprocess, "Popen", RecordingPopen)
    return RecordingPopen


def assert_scrubbed(spawned: list[dict | None]) -> None:
    assert spawned, "the flow spawned no subprocess; the test would prove nothing"
    for env, command in zip(spawned, RecordingPopen.commands):
        assert env is not None, f"spawned with the inherited environment: {command!r}"
        assert auth.TOKEN_ENV not in env and auth.INSECURE_ENV not in env
        assert SECRET not in env.values()


def test_minimal_env_drops_the_token_even_when_asked_to_pass_everything_through(monkeypatch):
    monkeypatch.setenv(auth.TOKEN_ENV, SECRET)
    for passthrough in [(), ("PATH", "HOME")]:
        env = minimal_env(passthrough=passthrough)
        assert auth.TOKEN_ENV not in env
    # Even an explicit (buggy) passthrough request cannot smuggle it in.
    assert auth.TOKEN_ENV not in minimal_env(passthrough=("PATH", auth.TOKEN_ENV, auth.INSECURE_ENV))


def test_trainability_job_worker_gets_no_token(secret_in_kernel_env, tmp_path):
    pytest.importorskip("qiskit")
    from kernel.tests._trainability_job_helpers import (
        FAKE_MODULE, QISKIT_CODE, connection, write_fake_analyses,
    )
    from kernel.trainability import job_worker, jobs
    from kernel.trainability.jobs import TrainabilityJobManager

    write_fake_analyses(tmp_path)
    previous = jobs.get_manager()
    manager = TrainabilityJobManager(
        extra_env={job_worker.OVERRIDE_ENV: FAKE_MODULE}, extra_sys_path=[str(tmp_path)])
    jobs.set_manager(manager)

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "trainability_start", "job_id": "j1", "code": QISKIT_CODE,
                     "observable": "Z0*Z1", "analyses": ["gradients"]})
            return await ws.wait_type("trainability_result", timeout=240)

    try:
        result = asyncio.run(scenario())
    finally:
        manager.release_all()
        jobs.set_manager(previous)
    assert result["status"] == "complete"
    assert_scrubbed(secret_in_kernel_env.spawned)


def test_conjecture_worker_gets_no_token(secret_in_kernel_env, tmp_path):
    from kernel.discovery.conjecture import jobs, worker
    from kernel.discovery.conjecture.jobs import ConjectureJobManager
    from kernel.tests._trainability_job_helpers import connection
    from kernel.tests.test_discovery_conjecture_protocol import CLAIM, FAKE_MODULE, FAKE_SOURCE

    (tmp_path / f"{FAKE_MODULE}.py").write_text(FAKE_SOURCE, encoding="utf-8")
    previous = jobs.get_manager()
    manager = ConjectureJobManager(
        extra_env={worker.OVERRIDE_ENV: FAKE_MODULE}, extra_sys_path=[str(tmp_path)])
    jobs.set_manager(manager)

    async def scenario():
        async with connection() as ws:
            ws.push({"type": "discovery_conjecture_test", "job_id": "j1",
                     "conjecture": {**CLAIM, "id": "ok"}, "seed": 5})
            return await ws.wait_type("discovery_conjecture_result")

    try:
        asyncio.run(scenario())
    finally:
        manager.release_all()
        jobs.set_manager(previous)
    assert_scrubbed(secret_in_kernel_env.spawned)


def test_candidate_sandbox_and_scorer_get_no_token(secret_in_kernel_env, tmp_path, monkeypatch):
    pytest.importorskip("stim")
    pytest.importorskip("pymatching")
    monkeypatch.setenv("NUCLEI_DISCOVERY_ISOLATION", "process")
    from kernel.discovery import isolation, manager as manager_module
    from kernel.discovery.manager import DiscoveryManager
    from kernel.tests._auth_harness import StreamingWS, serve_authenticated
    from kernel.tests.test_discovery_handlers import FAST, SEED_PATH, evaluate_msg

    isolation.reset_for_tests()
    manager_module.set_manager(DiscoveryManager(max_workers=1, cache_dir=str(tmp_path / "cache")))
    program = Path(SEED_PATH).read_text(encoding="utf-8")

    async def scenario():
        ws = StreamingWS()
        connection = asyncio.create_task(serve_authenticated(ws))
        try:
            ws.push(evaluate_msg(program, config=FAST))
            return (await ws.wait_for(lambda m: m.get("type") == "discovery_evaluation", 240))[0]
        finally:
            ws.close()
            await connection

    try:
        message = asyncio.run(scenario())
    finally:
        manager_module.set_manager(None)
        isolation.reset_for_tests()
    assert message["evaluation"]["status"] == "scored"
    assert len(secret_in_kernel_env.spawned) >= 2  # candidate worker + scorer
    assert_scrubbed(secret_in_kernel_env.spawned)


def test_kernel_never_spawns_a_subprocess_without_an_explicit_env():
    """An omitted ``env=`` inherits the whole environment, token included."""
    offenders: list[str] = []
    for path in sorted(KERNEL_DIR.rglob("*.py")):
        relative = path.relative_to(KERNEL_DIR)
        if relative.parts[0] == "tests" or "tests" in relative.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = ast.unparse(node.func)
            if name.endswith(("subprocess.Popen", "subprocess.run", "create_subprocess_exec",
                              "create_subprocess_shell", "subprocess.check_output", "subprocess.call")):
                if not any(keyword.arg == "env" for keyword in node.keywords):
                    offenders.append(f"{relative}:{node.lineno} {name}")
    assert offenders == [], "subprocess spawns that inherit the kernel environment:\n" + "\n".join(offenders)


# ── the runtime file (holds the token) is unreadable from a candidate ──────────


def _restricted_info():
    pytest.importorskip("stim")
    from kernel.discovery import isolation

    isolation.reset_for_tests()
    info = isolation.detect_isolation()
    if info.reads != isolation.READS_RESTRICTED:
        pytest.skip(f"no read-restricting sandbox on this host: {info.note or info.mode}")
    return info


_RUNTIME_PROBE = textwrap.dedent('''
    import stim
    def build():
        import os
        for label, path in {paths!r}:
            try:
                data = open(path).read()
                print("LEAK:" + label + ":" + data)
            except OSError as exc:
                print("DENIED:" + label + ":" + type(exc).__name__)
        print("ENV-TOKEN:" + str("NUCLEI_KERNEL_TOKEN" in os.environ))
        return stim.Circuit("H 0")
''')


def test_candidate_cannot_read_the_runtime_file(tmp_path, monkeypatch):
    info = _restricted_info()
    from kernel.discovery.sandbox import default_request, run_candidate

    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv(auth.RUNTIME_DIR_ENV, raising=False)
    monkeypatch.setenv(auth.TOKEN_ENV, SECRET)
    config = auth.build_config(token=SECRET, insecure=False, dev=False)
    default_file = auth.write_runtime_file(config, 9742)  # ~/.nuclei/runtime/kernel.json
    extra_dir = tmp_path / "custom-runtime"
    extra_file = auth.write_runtime_file(config, 9742, runtime_dir=extra_dir)
    assert default_file == home / ".nuclei" / "runtime" / auth.RUNTIME_FILE_NAME
    assert SECRET in default_file.read_text() and SECRET in extra_file.read_text()  # readable by us

    paths = [("default", str(default_file)), ("custom", str(extra_file)),
             ("dir-listing", str(default_file.parent))]
    response = run_candidate(
        default_request("stim_circuit", _RUNTIME_PROBE.format(paths=paths), "build",
                        [{"args": [], "kwargs": {}}]),
        wall_seconds=120, isolation=info,
    )
    assert response["status"] == "ok", response
    out = response["stdout"]
    assert SECRET not in out and "LEAK:" not in out
    assert "DENIED:default" in out and "DENIED:custom" in out
    assert "ENV-TOKEN:False" in out
    assert json.loads(default_file.read_text())["token"] == SECRET  # still fine for the owner


def test_runtime_dir_is_not_covered_by_any_sandbox_read_root(monkeypatch, tmp_path):
    """Structural twin of the behavioural test: the allow-list never includes the runtime dir."""
    from kernel.discovery import isolation

    monkeypatch.setenv("HOME", str(tmp_path))
    runtime = Path(auth.default_runtime_dir()).resolve()
    profile, params = isolation.mac_profile(None, isolation.python_read_roots())
    for root in isolation.python_read_roots():
        resolved = Path(root).resolve()
        assert runtime != resolved and resolved not in runtime.parents, (root, runtime)
    assert str(runtime) not in profile and not any(str(runtime) in p for p in params)
    assert sys.platform  # keep the import used on every platform
